# Standalone Relay architecture

```mermaid
flowchart TD
    UI[Browser interface] --> API[Relay API and mission state]
    API --> LOOP[Bounded Planner and Critic]
    LOOP <--> MEM[Official Meterless H-MEM]
    LOOP --> MODEL[Explicit inference adapter]
    MODEL --> SAMPLE[Default deterministic sample]
    MODEL --> NIGHT[Configured Nightshift Runtime]
    NIGHT --> NVIDIA[NVIDIA Nemotron]
    MODEL --> DIRECT[Explicit NVIDIA-direct development route]
    DIRECT --> NVIDIA
    LOOP --> DATA[Typed read adapter]
    DATA --> FIX[Default synthetic fixtures]
    DATA --> ZET[Configured Zetaris]
    ZET --> COURIER[Independent courier and route source]
    ZET --> SUPPLIER[Independent supplier source]
    LOOP --> CHECK[Deterministic checks and decision receipt]
    CHECK --> APPROVAL[Owner and plan-version approval]
    APPROVAL --> STORE[Durable simulated dispatch and outbox]
```

Baseline default: real H-MEM and application state, deterministic sample model/data, simulated operations. The live model and Zetaris paths require separately provisioned services and remain unverified. The private ROVER application is not included or required. A future private implementation may use the public DispatchPort contract.
