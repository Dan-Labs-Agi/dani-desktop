import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";

const python = process.env.DANI_HERMES_POLICY_PYTHON;

it.skipIf(!python || !existsSync(python)).each(["off", "on"])("admits only session-mounted MCP servers through native full-agent creation and model rebuild (tool search: %s)", async (toolSearch) => {
  const home = mkdtempSync(join(tmpdir(), "dani-mcp-authority-"));
  const fixture = join(home, "mcp.py");
  writeFileSync(fixture, `import json, sys
from pathlib import Path
label, root = sys.argv[1:]
with open(Path(root) / (label + '.events'), 'a') as log:
    log.write('started\\n')
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request:
        continue
    method = request.get('method')
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': label, 'version': '1'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'receipt', 'description': 'Harmless authority receipt', 'inputSchema': {'type': 'object', 'properties': {}}}]}
    elif method == 'tools/call':
        with open(Path(root) / (label + '.events'), 'a') as log:
            log.write('called\\n')
        result = {'content': [{'type': 'text', 'text': label + '-receipt'}]}
    else:
        result = {}
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
`);
  writeFileSync(join(home, "config.yaml"), JSON.stringify({
    model: { default: "test-model", provider: "custom:test" },
    providers: { test: { base_url: "http://127.0.0.1:9/v1", api_key: "fixture-key" } },
    tools: { tool_search: { enabled: toolSearch } },
    mcp_servers: Object.fromEntries(["browser", "alternate-browser"].map(name => [name, {
      command: python, args: ["-u", fixture, "foreign-" + name, home],
    }])),
  }));
  const bootstrap = fileURLToPath(new URL("./hermes-bootstrap.py", import.meta.url));
  const script = `
import asyncio, contextlib, importlib.util, json, os, shlex, sys
from pathlib import Path
from types import SimpleNamespace
async def main():
    spec = importlib.util.spec_from_file_location('dani', sys.argv[1])
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)
    bootstrap.install_runtime_policy()
    from acp.schema import McpServerStdio
    from acp_adapter.server import HermesACPAgent
    from acp_adapter.session import SessionManager
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    home = Path(os.environ['HERMES_HOME'])
    manager = SessionManager()
    server = HermesACPAgent(manager)
    try:
        state = manager.create_session(cwd=str(home))
        assert not list(home.glob('foreign-*.events')), 'saved-profile MCP connected before admitted mount'
        mounted = McpServerStdio(name='browser', command=sys.executable,
            args=['-u', str(home / 'mcp.py'), 'admitted', str(home)], env=[])
        await server._register_session_mcp_servers(state, [mounted])
        tool = 'mcp__browser__receipt'
        receipts = []
        for model in ['test-model', 'second-model']:
            server._switch_model(state, 'custom:test:' + model, keep_endpoint=True)
            from model_tools import get_tool_definitions
            available = {t['function']['name'] for t in get_tool_definitions(
                enabled_toolsets=state.agent.enabled_toolsets, disabled_toolsets=state.agent.disabled_toolsets,
                quiet_mode=True, skip_tool_search_assembly=True)}
            assert tool in available, 'admitted mount lost'
            assert {'terminal', 'read_file', 'patch'} <= state.agent.valid_tool_names
            messages = []
            name, arguments = (tool, {}) if tool in state.agent.valid_tool_names else ('tool_call', {'calls': [{'name': tool, 'arguments': {}}]})
            state.agent._execute_tool_calls(SimpleNamespace(tool_calls=[SimpleNamespace(
                function=SimpleNamespace(name=name, arguments=json.dumps(arguments)), id='receipt-' + model)]), messages, state.session_id)
            assert 'admitted-receipt' in json.dumps(messages), 'wrong MCP origin dispatched'
            receipts.append(model)
        assert not list(home.glob('foreign-*.events')), 'saved-profile MCP connected on rebuild'
        coding_file = home / 'coding.txt'
        coding_file.write_text('before')
        coding = [('patch', {'path': str(coding_file), 'old_string': 'before', 'new_string': 'after'}),
                  ('read_file', {'path': str(coding_file)}),
                  ('terminal', {'command': 'printf terminal-receipt > ' + shlex.quote(str(home / 'terminal.txt'))})]
        for name, arguments in coding:
            messages = []
            state.agent._execute_tool_calls(SimpleNamespace(tool_calls=[SimpleNamespace(
                function=SimpleNamespace(name=name, arguments=json.dumps(arguments)), id='coding-' + name)]), messages, state.session_id)
            if name == 'read_file':
                assert 'after' in json.dumps(messages), 'native read receipt missing'
        assert coding_file.read_text() == 'after'
        assert (home / 'terminal.txt').read_text() == 'terminal-receipt'
        return {'receipts': receipts, 'admittedCalls': (home / 'admitted.events').read_text().count('called'), 'foreignStarts': 0,
                'coding': ['patch', 'read_file', 'terminal']}
    finally:
        shutdown_mcp_servers()
with contextlib.redirect_stdout(sys.stderr):
    result = asyncio.run(main())
print(json.dumps(result))
`;
  try {
    const output = execFileSync(python!, ["-c", script, bootstrap], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, HERMES_HOME: home,
        HERMES_MANAGED_DIR: join(home, "managed"), PYTHONDONTWRITEBYTECODE: "1" },
      encoding: "utf8", timeout: 60_000,
    });
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      receipts: ["test-model", "second-model"], admittedCalls: 2, foreignStarts: 0,
      coding: ["patch", "read_file", "terminal"],
    });
  } finally { await removeTempDir(home); }
}, 65_000);
