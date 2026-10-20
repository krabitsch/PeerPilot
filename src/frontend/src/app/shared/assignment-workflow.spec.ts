import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting,HttpTestingController} from '@angular/common/http/testing';
import {ActivatedRoute,Router} from '@angular/router';
import {of} from 'rxjs';
import {AssignmentParticipationComponent} from './assignment-participation.component';
import {EvalAssignmentListComponent} from '../eval-assignment-list/eval-assignment-list.component';
import {PairingManagement} from '../core/services/assignment-workflow.service';
const student={id:1,username:'student1',email:'student1@example.com',role:'Student',evalueeEligible:true,evaluatorEligible:true,assignmentCount:2,courseCount:5};
const teacher={...student,id:20,username:'Katrin',role:'Bocal',evalueeEligible:false,evaluatorEligible:false,assignmentCount:0,courseCount:1};
const summary=():PairingManagement=>({assignment:{id:1,name:'Assignment 1',classid:4,courseName:'Course',req_eval:2},participants:[student,teacher],ungrouped:[],
  groups:[{id:2,name:'group2',eligible:true,leaderId:1,members:[{id:1,userId:1,user:student}]}],
  slots:[{groupId:2,round:2,kind:'RetryRequired',previousEvaluatorIds:[3],previousEvaluators:['previous'],candidateIds:[20]}],pairings:[]});
describe('assignment participation and pairing management',()=>{
  beforeEach(()=>TestBed.configureTestingModule({imports:[AssignmentParticipationComponent,EvalAssignmentListComponent],providers:[
    provideHttpClient(),provideHttpClientTesting(),{provide:ActivatedRoute,useValue:{queryParams:of({assignmentId:1})}},
    {provide:Router,useValue:{navigate:vi.fn()}}
  ]}));
  afterEach(()=>TestBed.inject(HttpTestingController).verify());
  const http=()=>TestBed.inject(HttpTestingController);
  function page(){const f=TestBed.createComponent(EvalAssignmentListComponent);f.detectChanges();http().expectOne('/api/eval/assignment/1/management').flush(summary());f.detectChanges();return f;}
  it('renders independent participation flags and restores a rejected grouped-evaluee change',()=>{
    const f=TestBed.createComponent(AssignmentParticipationComponent);f.componentRef.setInput('assignmentId',1);f.componentRef.setInput('assignmentName','Assignment 1');f.detectChanges();
    http().expectOne('/api/eval/assignment/1/participation').flush({participants:[student,teacher]});f.detectChanges();
    const inputs=f.nativeElement.querySelectorAll('input');expect(Array.from(inputs,(i:any)=>i.checked)).toEqual([true,true,false,false]);
    inputs[0].checked=false;inputs[0].dispatchEvent(new Event('change'));f.detectChanges();
    const req=http().expectOne('/api/eval/assignment/1/participation');expect(req.request.body).toEqual({participants:[{userId:1,evalueeEligible:false}]});
    req.flush({error:'This participant is already assigned to a group.'},{status:409,statusText:'Conflict'});f.detectChanges();
    expect(f.nativeElement.textContent).toContain('already assigned to a group');expect(inputs[0].checked).toBe(true);
  });
  it('generation opens configuration without mutations, defaults staff off and persists pool selections',()=>{
    const f=page(),c=f.componentInstance;c.open('generate');http().expectOne('/api/eval/assignment/1/management').flush(summary());f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Pairings required');expect(f.nativeElement.textContent).toContain('Evaluator pool');
    expect(c.pool().find(p=>p.id===20)?.evaluatorEligible).toBe(false);c.toggleEvaluator(20,true);c.generate();
    const req=http().expectOne('/api/eval/assignment/1/generate-simple-pairings');expect(req.request.body).toEqual({groupIds:[2],slots:[{groupId:2,round:2}],participants:[{userId:1,evaluatorEligible:true},{userId:20,evaluatorEligible:true}]});
    req.flush({count:1,message:'Created 1 missing pairing',unfilled:[]});http().expectOne('/api/eval/assignment/1/management').flush(summary());f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Created 1 missing pairing');
  });
  it('single pairing uses server-approved retry slot/candidates and supports evaluator without group',()=>{
    const f=page(),c=f.componentInstance;c.open('single');http().expectOne('/api/eval/assignment/1/management').flush(summary());f.detectChanges();
    expect(c.candidates().map(p=>p.id)).toEqual([20]);expect(f.nativeElement.textContent).toContain('Previous failed evaluator(s): previous');
    c.create();const req=http().expectOne('/api/eval/eval-assignments');expect(req.request.body).toEqual({assignmentId:1,evalueeGroupId:2,round:2,evaluatorUserId:20});
    req.flush({id:10});http().expectOne('/api/eval/assignment/1/management').flush(summary());
  });
  it('queue shows actual group members and retry history; counts include evaluator-only staff',()=>{
    const f=page(),c=f.componentInstance;c.open('queue');http().expectOne('/api/eval/assignment/1/management').flush(summary());f.detectChanges();
    expect(f.nativeElement.textContent).toContain('group2: student1');expect(f.nativeElement.textContent).toContain('Retry required');expect(f.nativeElement.textContent).toContain('Previous evaluator(s): previous');
    c.modal.set('counts');f.detectChanges();expect(c.counts().map(p=>p.id)).toEqual([20,1]);
    expect(f.nativeElement.textContent).toContain('Course total');expect(f.nativeElement.textContent).toContain('Katrin');
  });
  it('completed evaluations have no cancellation or overwrite controls',()=>{
    const f=page(),r=summary();r.pairings=[{id:1,evalueeGroupId:2,evaluatorUserId:3,evaluatorGroupId:null,round:1,status:'Submitted',outcome:'Failed',evalResponseId:null,evaluatorName:'previous',retryRequested:true}];
    f.componentInstance.data.set(r);f.detectChanges();expect(f.nativeElement.textContent).not.toContain('Cancel pending pairing');expect(f.nativeElement.textContent).not.toContain('Delete');
  });
  it('generation lists only required slots and submits exact round selections',()=>{
    const f=page(),c=f.componentInstance,r=summary();
    r.groups.push({...r.groups[0],id:99,name:'Satisfied group'});
    r.slots.push({...r.slots[0],round:1,kind:'InitialMissing',previousEvaluators:[]});
    c.open('generate');http().expectOne('/api/eval/assignment/1/management').flush(r);f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Satisfied group');
    expect(f.nativeElement.textContent).toContain('Initial pairing missing');
    expect(f.nativeElement.textContent).toContain('Retry required');
    c.toggleSlot(r.slots[1],false);c.generate();
    const req=http().expectOne('/api/eval/assignment/1/generate-simple-pairings');
    expect(req.request.body.slots).toEqual([{groupId:2,round:2}]);
    req.flush({count:1,message:'Created',unfilled:[]});
    http().expectOne('/api/eval/assignment/1/management').flush(summary());
  });

});
