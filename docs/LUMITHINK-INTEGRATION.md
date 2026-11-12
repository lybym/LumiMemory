# LumiThink integration boundary

LumiThink remains responsible for trusted identity, guardian relationship proof, Task/Turn state and speech interruption. LumiMemory owns personal-memory data and its scope. A raw device voiceprint must never be treated as sufficient authorization to read private memory.

The integration adapter will:
- map trusted LumiThink household/principal/subject references to LumiMemory tenant/principal/space references;
- pass a server-verified actor, never an agent-supplied freeform identity;
- prefetch authorized, confirmed memory with a bounded latency budget;
- treat recall failure as a degraded turn rather than a reason to block ASR/TTS;
- enqueue new evidence only for committed, policy-authorized, non-cancelled turns;
- honor Turn epoch fencing and deletion generations when publishing background observations.

The v0.1 service is not yet approved for real LumiThink child data.
