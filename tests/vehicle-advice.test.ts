import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adviseVehicle, vehicleAdviceInput, requiredFields, type VehicleAdviceInput, type VehicleGenerator } from "../src/vehicle-advice.ts";
import { createVehicleAdviceApp } from "../src/vehicle-advice-app.ts";
const provider=randomUUID();
function input():VehicleAdviceInput {const now=Date.now();return {contractVersion:"vehicle-advice-input-1.0",runId:randomUUID(),requestRevision:3,
  request:{selectedProviderId:provider,serviceType:"TAXI",vehicleType:"",pickupPresent:true,destinationPresent:true,requirementsPresent:false,scheduled:false},
  context:{entranceConfirmed:true,memoryUsed:true,memoryRevision:"a".repeat(64)},
  snapshot:{id:randomUUID(),source:"rover_registry",at:new Date(now).toISOString(),expiresAt:new Date(now+30000).toISOString(),providers:[{id:provider,vehicleType:"SIMULATED"}]}};}
function proposal(i:VehicleAdviceInput) {
  const missing=requiredFields(i),outcome=missing.length?"clarification":i.snapshot.providers.length?"valid_proposal":"infeasible";
  const chosen=i.snapshot.providers.find(p=>p.id===i.request.selectedProviderId)?.id??i.snapshot.providers[0]?.id??null;
  return {contractVersion:"vehicle-proposal-1.0",runId:i.runId,requestRevision:i.requestRevision,snapshotId:i.snapshot.id,outcome,
    providerId:outcome==="valid_proposal"?chosen:null,reasonCodes:outcome==="valid_proposal"?["eligible_current_provider",...(chosen===i.request.selectedProviderId?["selected_provider_retained"]:[])]:outcome==="clarification"?["details_needed"]:["no_eligible_provider"],clarificationFields:missing,execution:"none"};
}
function critique(i:VehicleAdviceInput) {return {contractVersion:"vehicle-critique-1.0",runId:i.runId,requestRevision:i.requestRevision,snapshotId:i.snapshot.id,approved:true,issues:[],refreshEvidence:false};}
test("optional federation is bounded shared context and never verifies requirements",async()=>{
  const i=input();i.request.requirementsPresent=true;
  i.context.federation={status:"available",revision:"a".repeat(64),scope:"local_simulation_test",constraintsVerified:false,seats:4,luggageItems:2};
  const {generator,calls}=controlled(i),r=await adviseVehicle(i,generator);
  assert.equal(r.status,"clarification");assert.deepEqual(r.proposal?.clarificationFields,["requirements"]);
  assert.deepEqual(calls[0].input.input.context.federation,calls[1].input.input.context.federation);
  assert.ok(!vehicleAdviceInput.safeParse({...i,context:{...i.context,federation:{...i.context.federation,constraintsVerified:true}}}).success);
  assert.ok(!vehicleAdviceInput.safeParse({...i,context:{...i.context,federation:{...i.context.federation,seats:999}}}).success);
});
function controlled(i:VehicleAdviceInput,mutate?:(value:any,n:number,system:string)=>unknown) {
  const calls:{system:string,input:any,signal:AbortSignal}[]=[];
  const generator:VehicleGenerator={async complete(system,data,signal){calls.push({system,input:data,signal});
    const value=system.includes("Planner contract:")?proposal(i):critique(i);
    return {value:mutate?mutate(value,calls.length,system):value,model:"controlled-test-model",provider:"controlled-test-adapter"};}};
  return {generator,calls};
}
test("valid advice uses same context for two separate calls and makes no selection or booking",async()=>{
  const i=input(),{generator,calls}=controlled(i),r=await adviseVehicle(i,generator);
  assert.equal(r.status,"valid_proposal");assert.equal(r.modelCalls,2);assert.equal(r.repairCount,0);assert.equal(r.execution,"none");assert.equal(r.bookingCreated,false);
  assert.deepEqual(calls[0].input.input,calls[1].input.input);assert.equal(calls[0].signal,calls[1].signal);
  assert.equal(i.request.selectedProviderId,provider);assert.ok(r.activity.some(s=>s.kind==="rule"));
  assert.equal(r.activity.filter(s=>s.kind==="model").length,2);assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
for(const scenario of ["pickup","destination","requirements","schedule"] as const) test(`clarification for ${scenario} cannot invent feasibility`,async()=>{
  const i=input();if(scenario==="pickup")i.request.pickupPresent=false;if(scenario==="destination")i.request.destinationPresent=false;
  if(scenario==="requirements")i.request.requirementsPresent=true;if(scenario==="schedule")i.request.scheduled=true;
  const r=await adviseVehicle(i,controlled(i).generator);assert.equal(r.status,"clarification");assert.equal(r.proposal?.providerId,null);assert.deepEqual(r.proposal?.clarificationFields,[scenario]);
});
test("infeasible branch is explicit when no mapped provider is eligible",async()=>{
  const i=input();i.snapshot.providers=[];const r=await adviseVehicle(i,controlled(i).generator);assert.equal(r.status,"infeasible");assert.equal(r.proposal?.providerId,null);
});
test("unknown provider gets exactly one targeted schema repair",async()=>{
  const i=input(),{generator,calls}=controlled(i,(v,n)=>n===1?{...v,providerId:randomUUID()}:v);
  const r=await adviseVehicle(i,generator);assert.equal(r.status,"valid_proposal");assert.equal(r.modelCalls,3);assert.equal(r.repairCount,1);
  assert.deepEqual(calls[1].input.repair,["provider_unknown"]);
});
test("independent critique failure repairs Planner once then rejects at four calls",async()=>{
  const i=input(),{generator,calls}=controlled(i,(v,_n,s)=>s.includes("Planner contract:")?v:{...v,approved:false,issues:["unsupported_claim"]});
  const r=await adviseVehicle(i,generator);assert.equal(r.status,"rejected");assert.equal(r.proposal,null);assert.equal(r.modelCalls,4);assert.equal(r.repairCount,1);
  assert.deepEqual(calls[2].input.repair,["unsupported_claim"]);
});
test("schema extra keys and fabricated prices never leave the coordinator",async()=>{
  const i=input(),{generator}=controlled(i,(v,_n,s)=>s.includes("Planner contract:")?{...v,priceCents:1,explanation:"PRIVATE"}:v);
  const r=await adviseVehicle(i,generator);assert.equal(r.status,"rejected");assert.equal(r.modelCalls,2);assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
test("old revision and mismatched critic snapshot reject even when approved",async()=>{
  for(const mode of ["revision","snapshot"]) {
    const i=input(),{generator}=controlled(i,(v,_n,s)=>mode==="revision"?{...v,requestRevision:2}:s.includes("Planner contract:")?v:{...v,snapshotId:randomUUID()});
    assert.equal((await adviseVehicle(i,generator)).status,"rejected");
  }
});
test("stale evidence skips inference; expiry during inference discards the proposal",async()=>{
  const i=input(),{generator,calls}=controlled(i),at=Date.parse(i.snapshot.at);
  assert.equal((await adviseVehicle(i,generator,()=>at+31000)).status,"stale_evidence");assert.equal(calls.length,0);
  let now=at;const delayed:VehicleGenerator={async complete(s,data,signal){const value=await generator.complete(s,data,signal);now+=16000;return value;}};
  const r=await adviseVehicle(i,delayed,()=>now);assert.equal(r.status,"stale_evidence");assert.equal(r.proposal,null);
});
test("critic can explicitly request refreshed evidence",async()=>{
  const i=input(),{generator}=controlled(i,(v,_n,s)=>s.includes("Planner contract:")?v:{...v,approved:false,issues:["refresh_required"],refreshEvidence:true});
  const r=await adviseVehicle(i,generator);assert.equal(r.status,"stale_evidence");assert.equal(r.repairCount,0);assert.equal(r.modelCalls,2);
});
test("inference outage is explicit with no automatic retry or sample output",async()=>{
  let calls=0;const generator:VehicleGenerator={async complete(){calls++;throw Error("PRIVATE unavailable");}};
  const r=await adviseVehicle(input(),generator);assert.equal(calls,1);assert.equal(r.status,"inference_unavailable");assert.equal(r.proposal,null);assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
test("one deadline is shared by repair and critique",async()=>{
  const i=input(),at=Date.parse(i.snapshot.at);let now=at;
  const {generator}=controlled(i,(v)=>{now+=20;return {...v,providerId:randomUUID()};});
  const r=await adviseVehicle(i,generator,()=>now,10);assert.equal(r.modelCalls,1);assert.equal(r.status,"inference_unavailable");
});
test("deadline bounds an inference adapter that ignores cancellation",async()=>{
  const keepAlive=setTimeout(()=>{},200);
  try {
    const r=await adviseVehicle(input(),{async complete(){return await new Promise<never>(()=>{});}},Date.now,20);
    assert.equal(r.status,"inference_unavailable");assert.equal(r.modelCalls,1);assert.equal(r.proposal,null);
  }finally{clearTimeout(keepAlive);}
});
test("input boundary rejects identity, private data, duplicate providers, long leases and mismatched vehicle",()=>{
  const i=input();assert.ok(!vehicleAdviceInput.safeParse({...i,ownerId:randomUUID()}).success);
  assert.ok(!vehicleAdviceInput.safeParse({...i,request:{...i.request,pickup:"PRIVATE ADDRESS"}}).success);
  assert.ok(!vehicleAdviceInput.safeParse({...i,snapshot:{...i.snapshot,providers:[...i.snapshot.providers,...i.snapshot.providers]}}).success);
  assert.ok(!vehicleAdviceInput.safeParse({...i,snapshot:{...i.snapshot,expiresAt:new Date(Date.parse(i.snapshot.at)+31000).toISOString()}}).success);
  assert.ok(!vehicleAdviceInput.safeParse({...i,request:{...i.request,vehicleType:"VAN"}}).success);
});
test("HTTP requires distinct server credential, bounds input and never advertises probed inference health",async()=>{
  const i=input(),{generator,calls}=controlled(i),token="a".repeat(40),app=createVehicleAdviceApp(token,generator);
  try {
    assert.equal((await app.inject({method:"GET",url:"/v1/health"})).json().inference,"not_probed");
    assert.equal((await app.inject({method:"POST",url:"/v1/integration/vehicle-advice",payload:i})).statusCode,401);assert.equal(calls.length,0);
    const r=await app.inject({method:"POST",url:"/v1/integration/vehicle-advice",headers:{authorization:`Bearer ${token}`},payload:i});assert.equal(r.statusCode,200);assert.equal(r.headers["cache-control"],"no-store");assert.equal(r.json().status,"valid_proposal");
    assert.equal((await app.inject({method:"POST",url:"/v1/integration/vehicle-advice",headers:{authorization:`Bearer ${token}`},payload:{...i,privateData:"bad"}})).statusCode,400);
  }finally{await app.close();}
});

test("a late final Critic response cannot approve after the shared clock deadline",async()=>{
  const i=input(),at=Date.parse(i.snapshot.at);let now=at;
  const {generator}=controlled(i,v=>{now+=6;return v;});
  const r=await adviseVehicle(i,generator,()=>now,10);
  assert.equal(r.status,"inference_unavailable");assert.equal(r.modelCalls,2);assert.equal(r.proposal,null);
});
