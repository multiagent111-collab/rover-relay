import { createVehicleAdviceApp } from "./vehicle-advice-app.ts";
const app=createVehicleAdviceApp(process.env.RELAY2_ADVICE_TOKEN??"");
const port=Number(process.env.RELAY2_ADVICE_PORT??4196);
if(!Number.isInteger(port)||port<1024||port>65535) throw Error("Invalid advice port");
await app.listen({host:"127.0.0.1",port});
console.log(JSON.stringify({service:"optional-vehicle-advice",port,contractVersion:"vehicle-advice-1.0",execution:"none"}));
for(const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,async()=>{await app.close();process.exit(0);});
