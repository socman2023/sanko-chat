import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("index.html"),app=read("assets/app.js"),css=read("assets/styles.css");

function mount(search="") {
 const classes=new Set(),styles=new Map(),calls=[],sessionCalls=[],listeners=[];
 const elements=new Map(),windowListeners=new Map(),viewportListeners=new Map();
 function node(id="") {
  return {
   id, style:{}, children:[], textContent:"", value:"", scrollHeight:48, scrollTop:0,
   disabled:false, hidden:true,
   addEventListener(name,fn) {this.handlers??={};this.handlers[name]=fn;},
   append(...items){this.children.push(...items);},
   replaceChildren(){this.children=[];},
   remove(){this.removed=true;},
   focus(){this.focused=true;},
   set className(v){this._className=v;},
   get className(){return this._className||"";},
   get scrollHeightValue(){return this.scrollHeight;},
  };
 }
 const el=id=>{if(!elements.has(id))elements.set(id,node(id));return elements.get(id);};
 const root={
  classList:{add(name){classes.add(name)}},
  style:{setProperty(name,value){styles.set(name,value);}}
 };
 const document={
  documentElement:root,
  getElementById:el,
  createElement:()=>node()
 };
 const sessionResponse=async()=>({
  ok:true,json:async()=>({verified:true,role:"stranger",firstName:""})
 });
 const window={
  location:{search},
  SANKO_CONFIG:{apiUrl:"https://sanko-chat-api.boysinger2008.workers.dev/api/chat"},
  innerHeight:775,
  visualViewport:{height:680,addEventListener(n,fn){viewportListeners.set(n,fn)}},
  addEventListener(n,fn){windowListeners.set(n,fn)},
  confirm(){return true;},
  vkBridge:{
   subscribe(fn){listeners.push(fn);},
   send(method){
    calls.push(method);
    if(method==="VKWebAppGetConfig")return Promise.resolve({insets:{top:20,bottom:25,left:0,right:0}});
    if(method==="VKWebAppGetUserInfo")return Promise.resolve({id:42,first_name:"Иван"});
    return Promise.resolve({});
   }
  }
 };
 const storage=new Map();
 const localStorage={
  getItem:key=>storage.get(key)??null,
  setItem:(key,value)=>storage.set(key,String(value)),
  removeItem:key=>storage.delete(key)
 };
 const fetch=async(url,options)=>{
  sessionCalls.push({url,options});
  return sessionResponse();
 };
 runInNewContext(app,{window,document,localStorage,fetch,URL,URLSearchParams,
  crypto:webcrypto,Uint32Array,Uint8Array,AbortController,setTimeout,clearTimeout,
  console},{filename:"assets/app.js",timeout:1000});
 return {classes,styles,calls,sessionCalls,elements,el,window,viewportListeners,listeners};
}
test("VK Mini App URL keeps the same HTTPS GitHub Pages application",()=>{
 assert.match(html,/https:\/\/unpkg\.com\/@vkontakte\/vk-bridge@2\.15\.12\/dist\/browser\.min\.js/);
 assert.match(html,/<meta name="referrer" content="no-referrer">/);
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/\.\/assets\/app\.js/);
 assert.match(html,/\.\/assets\/styles\.css/);
 assert.match(html,/enterkeyhint="send"/);
 assert(!html.includes("VK_APP_SECRET"));
});
test("ordinary browser stays standalone and never calls VK Bridge",()=>{
 const x=mount("");
 assert(!x.classes.has("vk-embedded"));
 assert(x.el("messages").children.length>0,"Chat greeting visible immediately");
 assert.equal(x.calls.length,0);
 assert.equal(x.sessionCalls.length,0);
});
test("VK app renders immediately before server session and initializes Bridge",async()=>{
 const x=mount("?vk_app_id=123456&vk_user_id=42&vk_platform=android&vk_ts=1762256400&sign=fake");
 assert(x.classes.has("vk-embedded"));
 assert(x.el("messages").children.length>0,"No empty chat while VK API loads");
 assert.equal(x.styles.get("--vk-visible-height"),"680px");
 assert(x.calls.includes("VKWebAppInit"));
 await new Promise(r=>setTimeout(r,40));
 assert(x.calls.includes("VKWebAppGetConfig"));
 assert(x.calls.includes("VKWebAppGetUserInfo"));
 assert(x.sessionCalls.some(v=>v.url.endsWith("/api/session")));
 const session=x.sessionCalls.find(v=>v.url.endsWith("/api/session"));
 const body=JSON.parse(session.options.body);
 assert.equal(body.vkFirstNameUserId,42);
 assert.equal(body.vkFirstName,"Иван");
 assert.equal(body.vkLaunch,x.window.location.search);
 assert.equal(x.styles.get("--vk-inset-bottom"),"25px");
 x.listeners[0]({detail:{type:"VKWebAppUpdateConfig",
  data:{insets:{top:37,bottom:53,left:9,right:10}}}});
 assert.equal(x.styles.get("--vk-inset-top"),"37px");
 assert.equal(x.styles.get("--vk-inset-bottom"),"53px");
 x.window.visualViewport.height=425;
 x.viewportListeners.get("resize")();
 assert.equal(x.styles.get("--vk-visible-height"),"425px");
});
test("unsuitable VK insets never become unsafe dimensions",async()=>{
 const x=mount("?vk_app_id=123456&vk_user_id=42&sign=unverified");
 x.listeners[0]({detail:{type:"VKWebAppUpdateConfig",
  data:{insets:{top:-20,bottom:999,left:"bad",right:12}}}});
 assert.equal(x.styles.get("--vk-inset-top"),undefined);
 assert.equal(x.styles.get("--vk-inset-bottom"),undefined);
 assert.equal(x.styles.get("--vk-inset-right"),"12px");
 await new Promise(r=>setTimeout(r,25));
});
test("VK-only CSS does not override the standalone layout",()=>{
 for(const token of [
  "html.vk-embedded","--vk-visible-height","--vk-inset-bottom",
  ".vk-embedded .side{display:none}",".vk-embedded .composer-wrap",
  ".vk-embedded .messages",".vk-embedded .topbar"
 ])assert(css.includes(token),token);
 assert(css.includes("safe-area-inset-bottom"),"VK must leave space for safe areas");
 assert(css.includes("@media(max-width:700px)"),"Regular mobile layout preserved");
});
