import {TestBed} from '@angular/core/testing';
import {HttpHeaders,provideHttpClient} from '@angular/common/http';
import {HttpTestingController,provideHttpClientTesting} from '@angular/common/http/testing';
import {ExportService} from './export-service';
// jsdom's Blob lacks the modern browser methods used by binary downloads.
beforeAll(()=>{
  if (!Blob.prototype.text) Object.defineProperty(Blob.prototype,'text',{configurable:true,value:function(){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsText(this);});
  }});
});

const frames=()=>Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
const grant={ticket:'tKt_123-abc',expiresAt:'2026-11-24T10:00:00Z',totalBytes:5*1024**3,submissions:40,recordings:80,includeRecordings:true};

describe('bulk ZIP download (ticket + native browser download)',()=>{
  let http:HttpTestingController,service:ExportService;
  beforeEach(()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
    http=TestBed.inject(HttpTestingController);service=TestBed.inject(ExportService);
    vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(()=>{http.verify();frames().forEach(f=>f.remove());vi.restoreAllMocks();});
  const ticketUrl='/api/export/assignment/1/archive-ticket';

  it('trades the session for a ticket and hands the ZIP URL to a hidden iframe, never an XHR blob',async()=>{
    const result=new Promise(resolve=>service.downloadAssignmentArchive(1,{recordings:false}).subscribe(resolve));
    const req=http.expectOne(ticketUrl);
    expect(req.request.method).toBe('POST');expect(req.request.body).toEqual({recordings:false});
    req.flush(grant);
    expect(await result).toEqual(grant);
    const [frame]=frames();
    expect(frame.style.display).toBe('none');
    expect(new URL(frame.src).pathname).toBe('/api/export/archive/tKt_123-abc');
    http.expectNone(r=>r.url.includes('/archive/'));
  });

  it('reports a refused ticket URL (expired / reused) read back from the frame',async()=>{
    const refused=vi.fn<(m:string)=>void>();
    const started=new Promise(resolve=>service.downloadAssignmentArchive(1,{recordings:true},refused).subscribe(resolve));
    http.expectOne(ticketUrl).flush(grant);
    await started;
    const [frame]=frames();
    // jsdom never loads the src, so stand in for the frame's document.
    const doc=document.implementation.createHTMLDocument('');
    Object.defineProperty(frame,'contentDocument',{configurable:true,get:()=>doc});
    // A started download leaves the frame's document empty: not an error.
    frame.dispatchEvent(new Event('load'));
    expect(refused).not.toHaveBeenCalled();
    doc.body.textContent='This download link has expired or was already used.';
    frame.dispatchEvent(new Event('load'));
    expect(refused).toHaveBeenCalledWith('This download link has expired or was already used.');
    expect(frames()).toHaveLength(0);
  });

  it('surfaces ticket errors (200 JSON envelope or real status) and starts nothing',async()=>{
    for(const flush of [
      (r:any)=>r.flush({ok:false,code:404,error:'Assignment not found'}),
      (r:any)=>r.flush({ok:false,error:'Insufficient permissions'},{status:403,statusText:'Forbidden'}),
    ]){
      const failed=new Promise<string>(resolve=>service.downloadAssignmentArchive(1).subscribe({error:e=>resolve(e.message)}));
      flush(http.expectOne(ticketUrl));
      expect(await failed).toMatch(/Assignment not found|Insufficient permissions/);
    }
    const noTicket=new Promise<string>(resolve=>service.downloadAssignmentArchive(1).subscribe({error:e=>resolve(e.message)}));
    http.expectOne(ticketUrl).flush({ok:true});
    expect(await noTicket).toContain('download link');
    expect(frames()).toHaveLength(0);
  });
});

describe('evaluations CSV (blob download)',()=>{
  let http:HttpTestingController,service:ExportService,click=vi.fn<()=>void>();
  beforeEach(()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
    http=TestBed.inject(HttpTestingController);service=TestBed.inject(ExportService);
    click=vi.fn<()=>void>();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(click);
    vi.stubGlobal('URL',class extends URL{static override createObjectURL=vi.fn(()=> 'blob:export');static override revokeObjectURL=vi.fn();});
    vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(()=>{http.verify();vi.restoreAllMocks();vi.unstubAllGlobals();});
  const url='/api/export/assignment/1/evaluations.csv';

  it('saves the CSV under the server-provided name',async()=>{
    let name='';click.mockImplementation(function(this:HTMLAnchorElement){name=this.download;});
    const done=new Promise<void>(resolve=>service.downloadEvaluationsCsv(1).subscribe({complete:resolve}));
    http.expectOne(url).flush(new Blob(['a,b\r\n'],{type:'text/csv'}),
      {headers:new HttpHeaders({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="Course-A-evaluations.csv"'})});
    await done;expect(name).toBe('Course-A-evaluations.csv');expect(click).toHaveBeenCalledOnce();
  });

  it('never saves JSON errors or non-CSV bodies',async()=>{
    for(const [body,type] of [['{"ok":false,"error":"Token expired","code":401}','application/json'],['<html>error</html>','text/html']]){
      const failure=new Promise<void>(resolve=>service.downloadEvaluationsCsv(1).subscribe({error:()=>resolve()}));
      http.expectOne(url).flush(new Blob([body],{type}),{headers:{'Content-Type':type}});
      await failure;
    }
    expect(click).not.toHaveBeenCalled();
  });
});
