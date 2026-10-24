import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {ActivatedRoute,Router} from '@angular/router';
import {TranslateModule} from '@ngx-translate/core';
import {of} from 'rxjs';
import {AssignmentCreateComponent} from './assignment-create.component';
import {AuthService} from '../../services/auth.service';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {EvalService} from '../../core/services/eval-service/eval-service';
const row=(id:number,marks:number,sortOrder:number,isBonus=false)=>({id,name:`Question ${id}`,description:'Description',marks,sortOrder,isBonus,sectionType:'Slider' as const});
describe('ordered core and bonus rubric editor',()=>{
 let saved:any[];
 const saveSections=vi.fn();const updateAssignment=vi.fn();
 beforeEach(()=>{
  saved=[row(1,70,1),row(2,30,0),row(3,15,2,true)];
  saveSections.mockReset().mockImplementation((id,sections)=>{saved=sections.map((s:any,i:number)=>({...s,sortOrder:i}));return of({id,sections:saved})});
  updateAssignment.mockReset().mockReturnValue(of({}));
  TestBed.configureTestingModule({imports:[AssignmentCreateComponent,TranslateModule.forRoot()],providers:[
   provideHttpClient(),{provide:ActivatedRoute,useValue:{queryParams:of({assId:1})}},
   {provide:Router,useValue:{navigate:vi.fn()}},{provide:AuthService,useValue:{user:()=>({id:1})}},
   {provide:CourseService,useValue:{getClass:()=>of({name:'Course'})}},
   {provide:AssignmentService,useValue:{getAssignmentById:()=>of({id:1,classid:2,name:'Assignment',description:'Description',max_score:100,req_eval:2,groupSize:1,pass_threshold:60}),updateAssignment}},
   {provide:EvalService,useValue:{getEvalSheetByAssignment:()=>of({id:1,sections:saved}),saveSections}},
  ]});
 });
 function page(){const f=TestBed.createComponent(AssignmentCreateComponent);f.detectChanges();return f}
 it('loads explicit order, moves sections and persists that order across reload',()=>{
  const f=page(),c=f.componentInstance;
  expect(c.pendingSections().map(s=>s.id)).toEqual([2,1,3]);
  c.moveSection(0,-1);expect(c.pendingSections().map(s=>s.id)).toEqual([2,1,3]);
  c.moveSection(1,-1);expect(c.pendingSections().map(s=>s.id)).toEqual([1,2,3]);
  c.onSave();expect(saveSections).toHaveBeenCalledWith(1,expect.arrayContaining([expect.objectContaining({id:1,sortOrder:0})]));
  expect(page().componentInstance.pendingSections().map(s=>s.id)).toEqual([1,2,3]);
 });
 it('100 core plus 15 bonus is valid, but 90 core plus 15 bonus cannot be saved',()=>{
  const c=page().componentInstance;
  expect(c.totalMarks()).toBe(100);expect(c.bonusMarks()).toBe(15);expect(c.remainingMarks()).toBe(0);
  c.onSave();expect(saveSections).toHaveBeenCalledOnce();saveSections.mockClear();updateAssignment.mockClear();
  c.pendingSections.update(ss=>ss.map(s=>s.id===2?{...s,marks:20}:s));c.onSave();
  expect(c.remainingMarks()).toBe(10);expect(saveSections).not.toHaveBeenCalled();expect(updateAssignment).not.toHaveBeenCalled();
 });
 it('allows adding optional bonus at a full core total and normalizes after deletion',()=>{
  const f=page(),c=f.componentInstance;c.activeTab.set(1);
  c.sectionName.set('Optional exercise');c.sectionDesc.set('Description');c.sectionMarks.set(20);c.sectionBonus.set(true);c.addSection();
  expect(c.totalMarks()).toBe(100);expect(c.bonusMarks()).toBe(35);
  c.removeSection(2);expect(c.pendingSections().map(s=>s.sortOrder)).toEqual([0,1,2]);
  f.detectChanges();expect(f.nativeElement.textContent).toContain('★ Bonus');
  expect(f.nativeElement.textContent).toContain('core pts remaining');
 });
});
