import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { adviseVehicle, vehicleAdviceInput, type VehicleGenerator } from "./vehicle-advice.ts";

export function createVehicleAdviceApp(token:string,generator?:VehicleGenerator,clock=Date.now) {
  if(token.length<32) throw Error("A separate server-only advice credential is required");
  const app=Fastify({logger:false,bodyLimit:32768,requestTimeout:185000});
  let active=0;
  app.get("/v1/health",async()=>({ok:true,contractVersion:"vehicle-advice-1.0",execution:"none",inference:"not_probed",dependsOn:["Nightshift"],maxCalls:4,maxRepairs:1,deadlineMs:180000}));
  app.post("/v1/integration/vehicle-advice",async(request,reply)=>{
    reply.header("Cache-Control","no-store");
    const supplied=Buffer.from(String(request.headers.authorization??"")),expected=Buffer.from(`Bearer ${token}`);
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return reply.code(401).send({error:"invalid_server_credential"});
    const input=vehicleAdviceInput.safeParse(request.body);
    if(!input.success) return reply.code(400).send({error:"invalid_vehicle_advice_input"});
    if(active>=2) return reply.code(429).send({error:"advice_busy"});
    active++;
    try {return await adviseVehicle(input.data,generator,clock);} finally {active--;}
  });
  return app;
}
