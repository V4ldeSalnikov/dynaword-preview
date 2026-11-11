import { AutoModelForCausalLM, AutoTokenizer, env, Tensor } from "@huggingface/transformers";
import { MODEL_ID, MODEL_REVISION } from "./data";
import { conversationMessages } from "./knowledge";
import { generateTokens } from "./generation";

env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
let model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>> | null = null;
let busy = false;
let stopped = false;
const send = (data: unknown) => self.postMessage(data);

self.addEventListener("message", async ({data}) => {
  if(data.type === "stop") { stopped=true; return; }
  if(busy) return;
  busy=true;
  try {
    if(data.type === "load") {
      const gpu=(navigator as unknown as {gpu?:{requestAdapter:()=>Promise<{features:Set<string>}|null>}}).gpu;
      const adapter=await gpu?.requestAdapter();
      if(!adapter) throw Error("This browser could not access WebGPU. Try a current Chrome or Edge on your Mac, with graphics acceleration enabled.");
      if(!adapter.features.has("shader-f16")) throw Error("This small model needs 16-bit WebGPU support. Try a current Chrome or Edge on your Mac.");
      const progress_callback=(p: any)=>send({type:"progress",status:p.status,file:p.file,loaded:p.loaded,total:p.total,progress:p.progress});
      tokenizer=await AutoTokenizer.from_pretrained(MODEL_ID,{revision:MODEL_REVISION,progress_callback});
      model=await AutoModelForCausalLM.from_pretrained(MODEL_ID,{revision:MODEL_REVISION,device:"webgpu",dtype:"q4f16",progress_callback});
      send({type:"ready"});
    } else if(data.type === "ask") {
      if(!model || !tokenizer) throw Error("Load the local model first.");
      stopped=false;
      const messages=[{role:"system",content:data.system},...conversationMessages(data.question,data.history||[],data.previous)];
      // The tokenizer forwards extra template arguments; its options type omits them.
      const templateOptions={add_generation_prompt:true,enable_thinking:false,return_dict:true} as const;
      const inputs=tokenizer.apply_chat_template(messages,templateOptions) as {input_ids:Tensor};
      const result=await generateTokens(model,Array.from(inputs.input_ids.data,BigInt),{
        eos:124900,maxTokens:384,stopped:()=>stopped,
        progress:(stage,tokens)=>send({type:"stage",id:data.id,stage,tokens}),
      });
      const text=tokenizer.decode(result.tokens,{skip_special_tokens:false});
      send({type:"answer",id:data.id,output:text,truncated:result.truncated});
    }
  } catch(error) {
    console.error("Local Dynaword model:",error);
    send({type:"error",id:data.id,message:error instanceof Error?error.message:String(error)});
  } finally {busy=false;}
});
