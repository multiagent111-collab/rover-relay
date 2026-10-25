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


# Submission checklist

## Prepared locally

- Entry description and form-ready answers for the confirmed team and Wildcard track.
- Current submission deck plus the longer integration/opportunities companion deck.
- Short edited native demo, captions, narration script and shot provenance (see the video folder after rendering).
- Reviewed standalone Relay source copy/ZIP, public update patch and local run instructions.
- Sanitized native and standalone evidence, source/provenance index and checksums.
- Existing ROVER platform/multimedia context separated from new event work.

## Participant actions before final submission

1. Resolve the proprietary host/private glue source boundary with the organizers. Preparation is not an eligibility ruling.
2. Review the exact source package and owner reuse/license choice. Keep all ROVER implementation private.
3. Publish the reviewed Relay-only update to the public repository using the provided patch/instructions. The currently checked public branch is still the pre-event baseline.
4. Open the repository signed out and perform the documented clean-clone local demo from the final public revision. Record that revision in the submission.
5. Watch the final MP4, then upload it to a judge-accessible video location accepted by HackOS. Local MP4 creation is not video hosting. Verify the link signed out.
6. Upload the deck, paste the current description and prior-work disclosure, confirm team/track in HackOS and submit.

The official page currently lists October 27, 2026, 23:45 UTC (4:45 PM PDT) as the deadline and asks for a 1–4 minute workflow video. This package targets roughly 110 seconds. Account-specific form fields and any organizer clarification still require participant review.

No cloud server, Android installation or running ROVER platform is needed to view the deck/video or run the public offline web sample. The web sample is not a live native fleet deployment.


# Form-ready answers

## Project name
ROVER Relay

## Team
Autonomous Multi-Agents for Real-time GPS Services

## Primary track
Wildcard [Tinkerer]: Bring Your Own Project

## Short description
Relay integrates federated provider information, confirmed memory and inspectable agent review into ROVER's existing vehicle and service workflow, with explicit human approval and separate provider acceptance.

## What we built during the event
We connected Relay's public architecture and generic services to the proprietary ROVER Android workflow. The extension adds native selection, saved drafts, actual H-MEM entrance recall, Zetaris federation across independent mapping/catalogue stores, and optional Nightshift Planner/Critic review. It logs structured decisions and enforces freshness before action. Synthetic simulation tests cover independent provider acceptance, tracking, cancellation, optional-service outages and state recovery.

## Sponsor use
Zetaris joins H2 provider mappings with an independent SQLite catalogue and supplies source revisions/timestamps. Official Meterless H-MEM remembers confirmed entrances and influences later saved pickups. Nightshift routes optional Planner/Critic calls to recorded NVIDIA Nemotron models, with bounded repair and deterministic checks. Synthetic provider data and simulated dispatch remain explicitly labeled.

## Why this is useful
ROVER combines provider discovery with a practical communication workflow. Relay adds reusable confirmed context and a reviewable basis for a service choice. The design can expand to authorized partner fleets and repeated service requests without making optional AI/data enhancements mandatory for the core workflow.

## How judges can try it
Use the source ZIP and `06_Run_and_Repository/Run_Relay_Locally.md` for an offline browser sample with real H-MEM and deterministic planning. View the short MP4 and deck for the recorded native ROVER integration. ROVER source and Android deployment are not part of the public reproduction.

## Repository
https://github.com/multiagent111-collab/rover-relay
Publish and verify the prepared entry update before submitting this URL as the final source. The checked public main is presently the declared baseline.

## Video / deck links
Upload the files in `04_Video` and `02_Presentation` through the accepted submission process. No hosted URL is invented here.

## Prior work and coding tools
The existing ROVER platform and entire Relay pre-event baseline are declared prior work. H-MEM is an attributed pre-existing third-party engine. New integration, safety/recovery and evaluation work are separately documented. Development used Codex. No Cursor use is claimed. The public/private source boundary requires organizer confirmation as described in the source-scope disclosure.
