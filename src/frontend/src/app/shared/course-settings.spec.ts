import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {ActivatedRoute, Router} from '@angular/router';
import {TranslateModule} from '@ngx-translate/core';
import {EMPTY, of, throwError} from 'rxjs';
import {CreateClassPage} from './CreateClassPage';
import {BocalClassesComponent} from '../bocal-panel/classes/bocal-classes.component';
import {AssignmentCreateComponent} from '../bocal-panel/assignment-create/assignment-create.component';
import {AuthService} from '../services/auth.service';
import {CourseService} from '../core/services/course-service/course-service';
import {AssignmentService} from '../core/services/course-service/Assignment.service';
import {EvalService} from '../core/services/eval-service/eval-service';
const course={id:1,org_id:1,name:'Course',description:'Description',term:'Fall 2026',externalCourseCodes:['1268','1269','1421'],pass_threshold:75,created_at:'2026-10-01',assignmentCount:1,studentCount:3};
describe('Bocal course metadata and assignment duration',()=>{
  const courses={createClass:vi.fn(()=>of(course)),updateClass:vi.fn(()=>of(course)),getClassByOrgId:()=>of([])};
  const assignments={createAssignment:vi.fn(()=>EMPTY),updateAssignment:vi.fn(()=>EMPTY)};
  beforeEach(async()=>{
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports:[CreateClassPage,BocalClassesComponent,AssignmentCreateComponent,TranslateModule.forRoot()],
      providers:[provideHttpClient(),
        {provide:AuthService,useValue:{user:()=>({id:5,orgId:1})}},
        {provide:ActivatedRoute,useValue:{queryParams:EMPTY}},{provide:Router,useValue:{navigate:vi.fn()}},
        {provide:CourseService,useValue:courses},{provide:AssignmentService,useValue:assignments},{provide:EvalService,useValue:{}},
      ],
    }).compileComponents();
  });
  it('Create Course saves term and comma-separated official codes',()=>{
    const fixture=TestBed.createComponent(CreateClassPage),c=fixture.componentInstance;
    for(const [label,value] of [['bocal_label_class_name','Course'],['field_description','Description'],['Term','Fall 2027'],['Official course numbers (comma-separated)','1268, 1421']])
      c.onFieldChanged({type:'text',label,value,icon:'',required:false,allowEdit:true});
    fixture.detectChanges();c.onSave();
    expect(courses.createClass).toHaveBeenCalledWith(expect.objectContaining({term:'Fall 2027',externalCourseCodes:['1268','1421']}));
  });
  it('group allocation uses independent saved evaluee eligibility, including explicitly enabled staff',()=>{
    const c=TestBed.createComponent(BocalClassesComponent).componentInstance;
    const a={id:1} as any;
    c.participationChanged(a,[
      {id:1,username:'Exempt',email:'one@example.com',role:'Student',evalueeEligible:false,evaluatorEligible:true},
      {id:2,username:'Student',email:'two@example.com',role:'Student',evalueeEligible:true,evaluatorEligible:false},
      {id:20,username:'Staff',email:'staff@example.com',role:'Bocal',evalueeEligible:true,evaluatorEligible:false},
    ]);
    expect(c.ungroupedStudentsFor(a).map(p=>p.id)).toEqual([2,20]);
    c.assignmentGroups.set(new Map([[1,[{id:2,name:'g',leaderId:2,members:[{id:1,userId:2}]}]]]));
    expect(c.ungroupedStudentsFor(a).map(p=>p.id)).toEqual([20]);
  });
  it('Edit Course preloads metadata and saves changes',()=>{
    const fixture=TestBed.createComponent(BocalClassesComponent),c=fixture.componentInstance;
    c.openEditClass(course);fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('#course-term') as HTMLInputElement).value).toBe('Fall 2026');
    expect(fixture.nativeElement.querySelector('input[type=range]')).toBeNull();
    c.editClassTerm.set('Spring 2027');c.editClassCodes.set('1268,1421,9999');c.onSaveClassEdit();
    expect(courses.updateClass).toHaveBeenCalledWith(1,expect.objectContaining({term:'Spring 2027',externalCourseCodes:['1268','1421','9999'],pass_threshold:75}));
  });
  it('rejected code removal stays in the modal and shows the backend error',()=>{
    const fixture=TestBed.createComponent(BocalClassesComponent),c=fixture.componentInstance;
    courses.updateClass.mockReturnValueOnce(throwError(()=>({error:{error:'Cannot remove course number: existing enrollments still use it.'}})));
    c.openEditClass(course);c.editClassCodes.set('1268,1421');c.onSaveClassEdit();fixture.detectChanges();
    expect(c.showEditClass()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('existing enrollments still use it');
  });
  for(const edit of [false,true])it(`assignment ${edit?'edit':'create'} validates and submits duration`,()=>{
    const fixture=TestBed.createComponent(AssignmentCreateComponent),c=fixture.componentInstance;
    Object.assign(c,{classId:1,assignmentId:2});c.editMode.set(edit);
    c.name.set('Assignment');c.description.set('Description');c.maxScore.set(100);c.reqEval.set(3);
    c.pendingSections.set([{name:'Score',description:'Score',marks:100,sectionType:'Slider'}]);
    expect(c.evaluationDurationMinutes()).toBe(30);
    c.evaluationDurationMinutes.set(4);c.onSave();expect(c.error()).toContain('5 to 180');
    c.evaluationDurationMinutes.set(45);c.onSave();
    expect(edit?assignments.updateAssignment:assignments.createAssignment).toHaveBeenCalledWith(edit?2:1,expect.objectContaining({evaluationDurationMinutes:45}));
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('#evaluation-duration') as HTMLInputElement).value).toBe('45');
  });
});
