// workerd treats every named export of the entry module as an entrypoint, so this module exports only the handler.
import Anthropic from "@anthropic-ai/sdk";

import { createRelay } from "./relay";

export default createRelay((env) => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
