import {TestBed} from '@angular/core/testing';
import {HttpHeaders,provideHttpClient} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {ExportService} from './export-service';
// jsdom's Blob lacks the modern browser methods used by binary downloads.
beforeAll(()=>{
  if (!Blob.prototype.text) Object.defineProperty(Blob.prototype,'text',{configurable:true,value:function(){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsText(this);});
  }});
  if (!Blob.prototype.arrayBuffer) Object.defineProperty(Blob.prototype,'arrayBuffer',{configurable:true,value:function(){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsArrayBuffer(this);});
  }});
});
describe('binary export validation',()=>{
  let http:HttpTestingController,service:ExportService,click=vi.fn<()=>void>();
  beforeEach(()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
    http=TestBed.inject(HttpTestingController);service=TestBed.inject(ExportService);
    click=vi.fn<()=>void>();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(click);
    vi.stubGlobal('URL',class extends URL{static override createObjectURL=vi.fn(()=> 'blob:export');static override revokeObjectURL=vi.fn();});
    vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(()=>{http.verify();vi.restoreAllMocks();vi.unstubAllGlobals();});
  const url='/api/export/assignment/1/archive';
  const zip=()=>new Blob([new Uint8Array([0x50,0x4b,3,4,0,0])],{type:'application/zip'});
  it('downloads binary ZIP with meaningful server name and preserves recordings toggle',async()=>{
    let done!:()=>void;const finished=new Promise<void>(r=>done=r);
    service.downloadAssignmentArchive(1,{recordings:false}).subscribe({complete:done});
    const req=http.expectOne(r=>r.url===url);expect(req.request.responseType).toBe('blob');expect(req.request.params.get('recordings')).toBe('0');
    let name='';click.mockImplementation(function(this:HTMLAnchorElement){name=this.download;});
    req.flush(zip(),{headers:new HttpHeaders({'Content-Type':'application/zip','Content-Disposition':'attachment; filename="peerofessor-Course-Assignment.zip"'})});
    await finished;expect(name).toBe('peerofessor-Course-Assignment.zip');expect(click).toHaveBeenCalledOnce();
  });
  it('never downloads 200 JSON errors or JSON masquerading as ZIP',async()=>{
    for(const type of ['application/json','application/zip']){
      const failure=new Promise<string>(resolve=>service.downloadAssignmentArchive(1).subscribe({error:e=>resolve(e.message)}));
      http.expectOne(url).flush(new Blob(['{"ok":false,"error":"Token expired","code":401}'],{type}),{headers:{'Content-Type':type}});
      expect(await failure).toContain(type==='application/json'?'Token expired':'valid ZIP');
    }
    expect(click).not.toHaveBeenCalled();
  });
  it('rejects non-ZIP MIME and empty bodies; uses a .zip fallback when header is absent',async()=>{
    for(const blob of [new Blob(['<html>error</html>'],{type:'text/html'}),new Blob([])]){
      const failure=new Promise<void>(resolve=>service.downloadAssignmentArchive(1).subscribe({error:()=>resolve()}));
      http.expectOne(url).flush(blob);await failure;
    }
    expect(click).not.toHaveBeenCalled();let name='';click.mockImplementation(function(this:HTMLAnchorElement){name=this.download;});
    const done=new Promise<void>(resolve=>service.downloadAssignmentArchive(1).subscribe({complete:resolve}));
    http.expectOne(url).flush(zip(),{headers:{'Content-Type':'application/zip'}});await done;expect(name).toBe('peerofessor-assignment-1.zip');
  });
  it('surfaces a real HTTP JSON-blob failure without downloading it',async()=>{
    const failed=new Promise<string>(resolve=>service.downloadAssignmentArchive(1).subscribe({error:e=>resolve(e.message)}));
    http.expectOne(url).flush(new Blob(['{"error":"Archive unavailable"}'],{type:'application/json'}),{status:500,statusText:'Error'});
    expect(await failed).toBe('Archive unavailable');expect(click).not.toHaveBeenCalled();
  });
});
