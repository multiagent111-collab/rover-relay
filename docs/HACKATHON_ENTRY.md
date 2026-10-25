# Current hackathon entry checkpoint

The October 24 entry is **Relay architecture/code integrated into the existing proprietary ROVER platform**, Wildcard [Tinkerer]. The package is assembled separately under `hackEntry`. Current native integration is demonstrated by recorded simulation, deck and sanitized acceptance evidence. The public standalone sample remains independently runnable.

# ROVER Relay: agent memory and federated service selection

**Team:** Autonomous Multi-Agents for Real-time GPS Services  
**Track:** Wildcard [Tinkerer]: Bring Your Own Project

## Problem and users

People requesting a vehicle or local service need more than a list of providers. They need current eligibility, useful service information, remembered instructions and a clear handoff. Operators also need to explain why a recommendation is suitable and what changed before approval.

## Existing platform and new contribution

ROVER is an existing proprietary Android multi-agent platform for discovering vehicles and services on a map and communicating with providers. Its service conversations and multimedia composition screens bring text, images, audio and video into the service workflow. AI Studio provides creation interfaces for configured external generation providers. These are existing platform capabilities, shown as context rather than claimed as new hackathon work. Screenshots do not establish that every paid generation provider or live media route was tested for this entry.

Our Tinkerer entry is the Relay architecture/code integrated into that platform. New work connects native vehicle/service selection, saved request review, confirmed entrance memory, optional federated catalogue context and optional Planner/Critic review. The existing ROVER backend retains user identity, approval and execution authority. Separate provider acceptance governs the synthetic dispatch workflow.

## Sponsor integration

**Zetaris:** the native review joins existing H2 provider mappings with an independently maintained SQLite service catalogue. Source revisions and observation/query metadata accompany the result. A catalogue change affects a new review while saved historical receipts retain their original evidence. These are real reads over synthetic local data, not live commercial fleet records.

**Meterless:** the official pinned H-MEM engine remembers an explicitly confirmed entrance and recalls it into a saved native pickup. The integration scopes context by verified identity and tenant and checks revisions. H-MEM is a pre-existing third-party engine. We integrated its behavior; we did not invent it. Forgetting removes future influence but is not a claim that every historical audit record is erased.

**Nightshift and NVIDIA:** explicitly requested Planner and separate Critic calls share the saved bounded context. A run permits four logical model calls and one targeted repair at most. Rule checks reject invalid or stale actionable advice. Actual local tests correlated model responses with Nightshift receipts and recorded routed Nemotron identities. Receipt signatures were not independently verified. Models do not confirm an offer or execute arbitrary SQL.

## Evidence and practical behavior

The October 24 local candidate passed 109 backend tests, 147 Relay2 tests and all four combinations of Nightshift/Zetaris availability. With both optional services stopped, the native simulation still saved a request, received explicit approval and separate provider acceptance, tracked it, cancelled it and released capacity. Native acceptance verified actual H-MEM influence. Isolated backup/restore and restart checks also passed. These are local functional results, not production uptime or scale claims.

## Reproducibility and source scope

Judges can run the included standalone Relay webpage locally without ROVER or sponsor credentials. That sample uses actual H-MEM with deterministic planning and synthetic operations. It is an architectural demonstration, not a browser mirror of the native fleet integration. Recorded native footage and sanitized evidence demonstrate the proprietary host integration. The public source contains Relay and generic integration contracts/adapters. ROVER Android/backend code, private glue, credentials, runtime stores and operational data remain excluded.

We declare the entire pre-event Relay baseline and the existing ROVER product. We identify event work with dated records and source checkpoints. Development used Codex; no Cursor usage is claimed. The source-requirement boundary for a proprietary host remains an organizer-confirmation item, not an assumed eligibility exception.


# Prior work, scope and rights

- Entry: **Relay architecture/code integrated into the existing ROVER platform**, Wildcard [Tinkerer].
- Existing ROVER Android/backend, JADE platform and broader map/messaging/multimedia features are prior work and remain proprietary.
- Entire Relay pre-event tag `rover-relay-pre-event-2026-10-21`, commit `1b19c528d639134691289d9c0db38d82e9f277ff`, is declared prior work, including initial UI/planning/adapters, simulation, synthetic data and H-MEM integration. A later commit date does not change that status.
- Relay2 fork parent is `c2b75e242f2dd87ec994acd4331b48ba823bdc93`, including its disclosed inherited working-tree material. The fork itself does not establish authorship during the event.
- Event extensions include the native selection/request/memory/simulation integrations, Zetaris catalogue federation, Nightshift review/activity and tested optional-service/recovery behavior. Dated summaries distinguish the independent standalone and native scopes.
- Official H-MEM revision: `1742dec56a66e58eef9dda2d2b865823758ca8cd`. Preserve its upstream license and notices.
- Codex authored the recorded event work. The current public event page makes Cursor optional. Do not claim Cursor development or credits.
- Only reviewed Relay source and generic public contracts are prepared for publication. No ROVER Android/backend implementation, private migrations, assets, credentials or Git history is included in the public source archive.
- No new application license has been selected on the owner's behalf. Existing notices remain. Decide reuse terms separately before inviting third-party reuse; sponsor/upstream terms still apply.
- Video edits use user-supplied recordings/screenshots and locally synthesized narration. Recorded actions are local simulation, with edited cuts and elapsed waiting removed. Existing map license markings stay visible.

## Source requirement to resolve before submission

The current event rules ask for a GitHub repository with all source code and permit declared pre-existing product code. They do not explicitly define whether a demonstrated proprietary host may remain closed. Do not infer organizer approval.

Suggested question: “Our Tinkerer entry integrates the publicly supplied Relay module and its Zetaris/Meterless features into our declared pre-existing proprietary ROVER platform. Can the complete Relay source and contracts be public while the ROVER Android/backend and private integration glue remain private, demonstrated by video and test evidence?”

Until confirmed, the reproducible public scope is standalone Relay and its public integration contracts. The native integration is disclosed as a recorded proprietary-host demonstration. If organizers require host/glue source, request an allowed private review or narrow the judged scope rather than publishing ROVER contrary to the owner's instructions.

Official rules: https://hackathon.genai.works/event/open-agent-hackathon-2026
