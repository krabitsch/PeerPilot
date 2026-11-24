import {TestBed} from '@angular/core/testing';
import {ActivatedRoute,Router} from '@angular/router';
import {of,throwError} from 'rxjs';
import {AnalyticsStudentComponent} from './analytics-student.component';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {GroupService} from '../../core/services/group-service/group-service';
import {EvalService,StudentEvaluation} from '../../core/services/eval-service/eval-service';
import {SubmissionService} from '../../core/services/submission-service/submission-service';
import {ExportService} from '../../core/services/export-service/export-service';
import {AssignmentWorkflowService} from '../../core/services/assignment-workflow.service';

// Issue 7: rows of the As evaluee / As evaluator tables open to show the grade,
// section scores, comment and reply of that evaluation.
const eve={id:5,username:'eve',email:'eve@example.com',role:'Student',evalueeEligible:true,evaluatorEligible:true};
const groups=[{id:4,name:'eve-group',members:[{userId:5,user:eve}]},{id:9,name:'zoe-group',members:[{userId:7}]}];
const pairings=[
  {id:1,round:1,status:'Submitted',evalueeGroupId:4,evaluatorUserId:7,evaluatorUser:{username:'zoe'},createdAt:'2026-11-01',outcome:'Passed',evalResponse:{id:31,recordingFileId:100}},
  {id:2,round:1,status:'Submitted',evalueeGroupId:9,evaluatorUserId:5,evaluatorUser:{username:'eve'},createdAt:'2026-11-02',outcome:'Failed',evalResponse:{id:32,recordingFileId:null}},
  {id:3,round:2,status:'Pending',evalueeGroupId:4,evaluatorUserId:8,evaluatorUser:{username:'max'},createdAt:'2026-11-03',outcome:'Pending',evalResponse:null},
];
const details:StudentEvaluation[]=[
  {pairingId:1,direction:'received',round:1,status:'Submitted',outcome:'Passed',response:{id:31,givenMarks:68,coreScore:68,bonusScore:0,
    comment:'Clear derivation,\nbut check the transversality condition.',reply:'Thanks, fixed it.',hasRecording:true,
    scores:[{sectionId:1,name:'Content',score:30,marks:40,isBonus:false},{sectionId:2,name:'Method',score:38,marks:60,isBonus:false}]}},
  {pairingId:2,direction:'given',round:1,status:'Submitted',outcome:'Failed',response:{id:32,givenMarks:40,coreScore:40,bonusScore:0,
    comment:'Missing the steady state.',reply:null,hasRecording:false,scores:[]}},
];

const getRecordingUrl=vi.fn((id:number)=>of({url:`https://example.test/files/rec-${id}`}));
let getStudentEvaluations:ReturnType<typeof vi.fn>;

describe('student analytics: expandable evaluation rows',()=>{
  let hrefs:string[];
  beforeEach(()=>{
    vi.clearAllMocks();hrefs=[];
    getStudentEvaluations=vi.fn(()=>of(details));
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){hrefs.push(this.href);});
    TestBed.configureTestingModule({providers:[
      {provide:ActivatedRoute,useValue:{queryParamMap:of(new Map([['classId','4'],['assId','1'],['studentId','5']]))}},
      {provide:Router,useValue:{navigate:vi.fn()}},
      {provide:CourseService,useValue:{getClass:()=>of({name:'Course'})}},
      {provide:AssignmentService,useValue:{getAssignments:()=>of([{id:1,name:'A1',req_eval:2,max_score:100,pass_threshold:50}])}},
      {provide:GroupService,useValue:{getGroupsForAssignment:()=>of(groups)}},
      {provide:EvalService,useValue:{getEvalAssignments:()=>of(pairings),getRecordingUrl,get getStudentEvaluations(){return getStudentEvaluations;}}},
      {provide:SubmissionService,useValue:{getGroupSubmissions:()=>of([]),getDownloadUrl:vi.fn()}},
      {provide:ExportService,useValue:{}},
      {provide:AssignmentWorkflowService,useValue:{summary:()=>of({participants:[eve],slots:[]})}},
    ]});
  });
  afterEach(()=>vi.restoreAllMocks());

  const render=()=>{const f=TestBed.createComponent(AnalyticsStudentComponent);f.detectChanges();return f;};
  const tables=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLTableElement>('table.detail-table'));
  const text=(el:Element|null)=>(el?.textContent??'').replace(/\s+/g,' ').trim();

  it('loads the details once for this student, scoped server-side',()=>{
    render();
    expect(getStudentEvaluations).toHaveBeenCalledTimes(1);
    expect(getStudentEvaluations).toHaveBeenCalledWith(1,5);
  });

  it('a received evaluation opens to grade, sections, comment, reply and recording, and closes again',()=>{
    const f=render();const [asEvaluee]=tables(f.nativeElement);
    const toggle=asEvaluee.querySelector<HTMLButtonElement>('button.row-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(asEvaluee.querySelector('.eval-detail')).toBeNull();

    toggle.click();f.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel=asEvaluee.querySelector('.eval-detail')!;
    expect(text(panel.querySelector('.eval-grade-label'))).toBe('Grade received');
    expect(text(panel.querySelector('.eval-grade-value'))).toBe('68 / 100');
    expect(text(panel)).toContain('pass mark 50%');
    expect(text(panel)).toContain('✓ Passed');
    const sections=Array.from(panel.querySelectorAll('.eval-sections li')).map(li=>[text(li.querySelector('.eval-section-name')),text(li.querySelector('.eval-section-score'))]);
    expect(sections).toEqual([['Content','30 / 40'],['Method','38 / 60']]);
    expect(text(panel)).toContain('Comment from zoe');
    expect(panel.querySelector('.eval-text')!.textContent).toBe('Clear derivation,\nbut check the transversality condition.');
    expect(text(panel)).toContain('Reply from eve-group');
    expect(text(panel)).toContain('Thanks, fixed it.');

    (panel.querySelector('button.eval-recording') as HTMLButtonElement).click();
    expect(getRecordingUrl).toHaveBeenCalledWith(31);
    expect(hrefs).toEqual(['https://example.test/files/rec-31']);

    toggle.click();f.detectChanges();
    expect(asEvaluee.querySelector('.eval-detail')).toBeNull();
  });

  it('a given evaluation shows what the student wrote and that no reply came yet',()=>{
    const f=render();const [,asEvaluator]=tables(f.nativeElement);
    asEvaluator.querySelector<HTMLButtonElement>('button.row-toggle')!.click();f.detectChanges();
    const panel=asEvaluator.querySelector('.eval-detail')!;
    expect(text(panel.querySelector('.eval-grade-label'))).toBe('Grade given');
    expect(text(panel.querySelector('.eval-grade-value'))).toBe('40 / 100');
    expect(text(panel)).toContain('× Failed');
    expect(text(panel)).toContain('eve’s comment');
    expect(text(panel)).toContain('Missing the steady state.');
    expect(text(panel)).toContain('Reply from zoe-group');
    expect(text(panel)).toContain('No reply yet.');
    expect(text(panel)).toContain('No recording');
    expect(panel.querySelector('.eval-sections')).toBeNull();
  });

  it('pending rows have nothing to open',()=>{
    const f=render();const [asEvaluee]=tables(f.nativeElement);
    const rows=Array.from(asEvaluee.querySelectorAll('tbody tr'));
    const pending=rows.find(r=>text(r).includes('max'))!;
    expect(text(pending)).toContain('Pending');
    expect(pending.querySelector('button.row-toggle')).toBeNull();
    expect(asEvaluee.querySelectorAll('button.row-toggle').length).toBe(1);
  });

  it('several rows can be open at once',()=>{
    const f=render();const root:HTMLElement=f.nativeElement;
    root.querySelectorAll<HTMLButtonElement>('button.row-toggle').forEach(b=>b.click());f.detectChanges();
    expect(root.querySelectorAll('.eval-detail').length).toBe(2);
  });

  it('if the details fail to load, the tables still work and an opened row says so',()=>{
    getStudentEvaluations=vi.fn(()=>throwError(()=>new Error('boom')));
    const f=render();const [asEvaluee]=tables(f.nativeElement);
    expect(text(asEvaluee)).toContain('zoe');
    expect(text(asEvaluee)).toContain('✓ Passed');
    asEvaluee.querySelector<HTMLButtonElement>('button.row-toggle')!.click();f.detectChanges();
    expect(text(asEvaluee.querySelector('.eval-detail'))).toBe('Could not load the evaluation details.');
  });
});
