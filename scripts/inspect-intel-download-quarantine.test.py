import importlib.util
import pathlib
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).with_name('inspect-intel-download-quarantine.py')
spec = importlib.util.spec_from_file_location('quarantine_inspection', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QuarantineObservationTests(unittest.TestCase):
    def test_apple_script_quoting_preserves_paths(self):
        self.assertEqual(module.quoted('/tmp/Intel app.app'), '"/tmp/Intel app.app"')
        self.assertEqual(module.quoted('a"b'), '"a\\"b"')

    def test_required_command_fails_closed(self):
        with patch.object(module.subprocess, 'run') as run:
            run.return_value.returncode = 1
            run.return_value.stderr = 'no download'
            with self.assertRaises(RuntimeError):
                module.run(['screencapture'])

    def test_observation_never_mutates_quarantine_or_approves_a_security_exception(self):
        text = path.read_text()
        self.assertNotIn("'--master-disable'", text)
        self.assertNotIn("'-cr'", text)
        self.assertNotIn("'-d', 'com.apple.quarantine'", text)
        self.assertNotIn('click button', text)
        self.assertNotIn("['curl'", text)
        self.assertIn("if app_quarantine.returncode:", text)
        self.assertIn("if verify.returncode:", text)
        self.assertIn("if digest != EXPECTED_HASH:", text)


if __name__ == '__main__':
    unittest.main()
