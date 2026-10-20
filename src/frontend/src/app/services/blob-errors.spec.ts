import {HttpErrorResponse,HttpRequest,HttpResponse} from '@angular/common/http';
import {firstValueFrom,of} from 'rxjs';
import {ErrorNormalizerInterceptor} from './error-normalizer.interceptor';
import {AuthInterceptor} from './auth-interceptor';
// jsdom's Blob lacks the modern browser methods used by binary downloads.
beforeAll(()=>{
  if (!Blob.prototype.text) Object.defineProperty(Blob.prototype,'text',{configurable:true,value:function(){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsText(this);});
  }});
  if (!Blob.prototype.arrayBuffer) Object.defineProperty(Blob.prototype,'arrayBuffer',{configurable:true,value:function(){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsArrayBuffer(this);});
  }});
});
describe('blob API errors and authentication refresh',()=>{
  const expired=()=>new HttpResponse({body:new Blob(['{"ok":false,"error":"Token expired","code":401}'],{type:'application/json'}),headers:undefined});
  it('normalizes the exact 47-byte expired-token envelope to 401',async()=>{
    const response=expired();expect(response.body!.size).toBe(47);
    await expect(firstValueFrom(new ErrorNormalizerInterceptor().intercept(new HttpRequest('GET','/api/export/assignment/1/archive'),{handle:()=>of(response)}))).rejects.toMatchObject({status:401,error:{error:'Token expired'}});
  });
  it('refreshes and retries the binary request before exposing it to the download service',async()=>{
    const token='header.'+btoa(JSON.stringify({userId:1}))+'.signature';
    const auth={getToken:()=>token,refreshToken:vi.fn(()=>of({accessToken:token})),setToken:vi.fn()};
    const normalize=new ErrorNormalizerInterceptor();let calls=0;
    const next={handle:(req:HttpRequest<any>)=>normalize.intercept(req,{handle:()=>of(++calls===1?expired():new HttpResponse({body:new Blob(['PK'])}))})};
    const result=await firstValueFrom(new AuthInterceptor(auth as any).intercept(new HttpRequest('GET','/api/export/assignment/1/archive'),next));
    expect(result).toBeInstanceOf(HttpResponse);expect(calls).toBe(2);expect(auth.refreshToken).toHaveBeenCalledOnce();
  });
});
