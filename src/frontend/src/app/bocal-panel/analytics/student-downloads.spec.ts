import {TestBed} from '@angular/core/testing';
import {ActivatedRoute,Router} from '@angular/router';
import {of} from 'rxjs';
import {AnalyticsStudentComponent} from './analytics-student.component';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {GroupService} from '../../core/services/group-service/group-service';
import {EvalService} from '../../core/services/eval-service/eval-service';
import {SubmissionService} from '../../core/services/submission-service/submission-service';
import {ExportService} from '../../core/services/export-service/export-service';
import {AssignmentWorkflowService} from '../../core/services/assignment-workflow.service';

const eve={id:5,username:'eve',email:'eve@example.com',role:'Student',evalueeEligible:true,evaluatorEligible:true};
const groups=[{id:4,name:'eve-group',members:[{userId:5,user:eve}]},{id:9,name:'zoe-group',members:[{userId:7}]}];
const pairings=[
  // received by eve's group, with a recording
  {id:1,round:1,status:'Submitted',evalueeGroupId:4,evaluatorUserId:7,evaluatorUser:{username:'zoe'},createdAt:'2026-11-01',outcome:'Passed',evalResponse:{id:31,recordingFileId:100}},
  // given by eve, with a recording
  {id:2,round:1,status:'Submitted',evalueeGroupId:9,evaluatorUserId:5,evaluatorUser:{username:'eve'},createdAt:'2026-11-02',outcome:'Passed',evalResponse:{id:32,recordingFileId:101}},
  // given by eve, no recording yet
  {id:3,round:2,status:'Pending',evalueeGroupId:9,evaluatorUserId:5,evaluatorUser:{username:'eve'},createdAt:'2026-11-03',outcome:'Pending',evalResponse:null},
  // unrelated to eve
  {id:4,round:1,status:'Submitted',evalueeGroupId:9,evaluatorUserId:8,createdAt:'2026-11-04',outcome:'Passed',evalResponse:{id:33,recordingFileId:102}},
];
const files=[{id:61,name:'report.pdf',size:2048,createdAt:'2026-11-01T09:00:00Z'},{id:62,name:'report-v2.pdf',size:4096,createdAt:'2026-11-05T09:00:00Z'}];

const getDownloadUrl=vi.fn((_g:number,_u?:number,fileId?:number)=>of({url:`https://example.test/files/sub-${fileId}`}));
const getRecordingUrl=vi.fn((id:number)=>of({url:`https://example.test/files/rec-${id}`}));
const downloadAssignmentArchive=vi.fn(()=>of({ticket:'t',expiresAt:'',totalBytes:3*1024**2,submissions:2,recordings:2,includeRecordings:true}));
const downloadEvaluationsCsv=vi.fn(()=>of(undefined));

describe('student analytics: downloads',()=>{
  let hrefs:string[];
  beforeEach(()=>{
    vi.clearAllMocks();hrefs=[];
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){hrefs.push(this.href);});
    TestBed.configureTestingModule({providers:[
      {provide:ActivatedRoute,useValue:{queryParamMap:of(new Map([['classId','4'],['assId','1'],['studentId','5']]))}},
      {provide:Router,useValue:{navigate:vi.fn()}},
      {provide:CourseService,useValue:{getClass:()=>of({name:'Course'})}},
      {provide:AssignmentService,useValue:{getAssignments:()=>of([{id:1,name:'A1',req_eval:2,max_score:100,pass_threshold:50}])}},
      {provide:GroupService,useValue:{getGroupsForAssignment:()=>of(groups)}},
      {provide:EvalService,useValue:{getEvalAssignments:()=>of(pairings),getRecordingUrl}},
      {provide:SubmissionService,useValue:{getGroupSubmissions:()=>of([{id:40,files}]),getDownloadUrl}},
      {provide:ExportService,useValue:{downloadAssignmentArchive,downloadEvaluationsCsv}},
      {provide:AssignmentWorkflowService,useValue:{summary:()=>of({participants:[eve],slots:[]})}},
    ]});
  });
  afterEach(()=>vi.restoreAllMocks());

  const render=()=>{const f=TestBed.createComponent(AnalyticsStudentComponent);f.detectChanges();return f;};
  const lists=(root:HTMLElement)=>Array.from(root.querySelectorAll('.download-list'));

  it('lists the group\'s files (original + retry) and only the recordings involving the student',()=>{
    const f=render();const [subs,recs]=lists(f.nativeElement);
    expect(subs.textContent).toContain('report.pdf');
    expect(subs.textContent).toContain('Original');
    expect(subs.textContent).toContain('Retry 1');
    const recRows=Array.from(recs.querySelectorAll('.download-row')).map(r=>r.textContent!.replace(/\s+/g,' ').trim());
    expect(recRows).toHaveLength(2);
    expect(recRows[0]).toContain('Received · Round 1');expect(recRows[0]).toContain('from zoe');
    expect(recRows[1]).toContain('Given · Round 1');expect(recRows[1]).toContain('for zoe-group');
  });

  it('downloads single files and recordings in the same tab',()=>{
    const open=vi.spyOn(window,'open').mockImplementation(()=>null);
    const f=render();const [subs,recs]=lists(f.nativeElement);
    (subs.querySelectorAll('button.row-download')[1] as HTMLButtonElement).click();
    (recs.querySelectorAll('button.row-download')[1] as HTMLButtonElement).click();
    expect(getDownloadUrl).toHaveBeenCalledWith(4,undefined,62);
    expect(getRecordingUrl).toHaveBeenCalledWith(32);
    expect(hrefs).toEqual(['https://example.test/files/sub-62','https://example.test/files/rec-32']);
    expect(open).not.toHaveBeenCalled();
  });

  it('bundles are scoped to the student: ZIP via ticket, CSV of evaluations and replies',()=>{
    const f=render();const root:HTMLElement=f.nativeElement;
    const button=(label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button.download-btn')).find(b=>b.textContent!.includes(label))!;
    button('Everything (ZIP)').click();f.detectChanges();
    expect(downloadAssignmentArchive).toHaveBeenCalledWith(1,{recordings:true,studentId:5},expect.any(Function));
    expect(root.querySelector('.download-notice')!.textContent).toContain('3.0 MB');
    button('Evaluations & replies (CSV)').click();
    expect(downloadEvaluationsCsv).toHaveBeenCalledWith(1,5);
  });
});
