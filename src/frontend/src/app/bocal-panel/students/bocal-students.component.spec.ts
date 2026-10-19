import {TestBed} from '@angular/core/testing';
import {ActivatedRoute} from '@angular/router';
import {TranslateModule} from '@ngx-translate/core';
import {EMPTY, of} from 'rxjs';
import {BocalStudentsComponent, OrgMember} from './bocal-students.component';
import {AuthService} from '../../services/auth.service';
import {OrgService} from '../../core/services/org-service/org-service';
import {CourseService} from '../../core/services/course-service/course-service';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
import {EnrollService, RosterResult} from '../../core/services/enroll-service/enroll-service';

const registered:OrgMember={id:7,username:'anna',email:'anna@wu.at',role:'Student',created_at:'2026-10-01',pending:false};
const pending:OrgMember={id:9,username:'new',email:'new@wu.at',role:'Student',created_at:'2026-10-19',pending:true};

describe('Bocal students: adding students to a course',()=>{
  let members:OrgMember[],roster:any[],results:RosterResult[];
  const org={listOrgMembers:vi.fn(()=>of(members))};
  const courses={getClassByOrgId:vi.fn(),getClassStudents:vi.fn(()=>of(roster))};
  const enroll={enrollByEmail:vi.fn(()=>of({results}))};
  const setup=(codes:string[])=>{
    members=[registered];roster=[];results=[];
    vi.clearAllMocks();
    courses.getClassByOrgId.mockReturnValue(of([{id:1,name:'Macro',externalCourseCodes:codes}]));
    TestBed.configureTestingModule({
      imports:[BocalStudentsComponent,TranslateModule.forRoot()],
      providers:[
        {provide:AuthService,useValue:{user:()=>({id:5,orgId:1})}},
        {provide:ActivatedRoute,useValue:{queryParams:of({classId:'1'})}},
        {provide:OrgService,useValue:org},{provide:CourseService,useValue:courses},
        {provide:AssignmentService,useValue:{getAssignments:()=>of([]),getAssignmentById:()=>EMPTY}},
        {provide:EnrollService,useValue:enroll},
      ],
    });
    const fixture=TestBed.createComponent(BocalStudentsComponent);fixture.detectChanges();
    return {fixture,c:fixture.componentInstance};
  };

  it('needs a course number, enrols by email and marks the not-yet-registered student',()=>{
    const {fixture,c}=setup(['1268','1421']);
    c.addEmail.set(' new@wu.at ');
    expect(c.canAddSingle()).toBe(false);
    c.addCode.set('1421');
    expect(c.canAddSingle()).toBe(true);

    results=[{email:'new@wu.at',externalCourseCode:'1421',status:'enrolled',account:'created',userId:9}];
    members=[registered,pending];roster=[{...pending,externalCourseCode:'1421'}];
    c.addToClass();fixture.detectChanges();

    expect(enroll.enrollByEmail).toHaveBeenCalledWith(1,[{email:'new@wu.at',externalCourseCode:'1421'}]);
    expect(c.rosterNotice()).toBe('roster_added_pending');
    expect(c.addEmail()).toBe('');
    expect(org.listOrgMembers).toHaveBeenCalledTimes(2);
    const text=fixture.nativeElement.textContent;
    expect(text).toContain('badge_not_registered');
    expect(text).toContain('1421');
  });

  it('bulk lines default to the selected number and failed lines stay in the box',()=>{
    const {c}=setup(['1268','1269','1421']);
    c.addCode.set('1268');
    c.bulkText.set('a@wu.at, 1421\nb@wu.at\n\n  c@wu.at;1269 ');
    results=[
      {email:'a@wu.at',externalCourseCode:'1421',status:'enrolled',account:'registered',userId:1},
      {email:'b@wu.at',externalCourseCode:'1268',status:'failed',error:'b@wu.at belongs to another organisation'},
      {email:'c@wu.at',externalCourseCode:'1269',status:'updated',account:'pending',userId:3},
    ];
    c.addBulk();

    expect(enroll.enrollByEmail).toHaveBeenCalledWith(1,[
      {email:'a@wu.at',externalCourseCode:'1421'},
      {email:'b@wu.at',externalCourseCode:'1268'},
      {email:'c@wu.at',externalCourseCode:'1269'},
    ]);
    expect(c.bulkText()).toBe('b@wu.at, 1268');
    expect(c.rosterFailures().map(f=>f.email)).toEqual(['b@wu.at']);
    expect(c.rosterNotice()).toBe('roster_summary');
  });

  it('a course with one official number needs no choice, and one without numbers sends none',()=>{
    let {c}=setup(['1268']);
    c.addEmail.set('anna@wu.at');
    expect(c.canAddSingle()).toBe(true);
    c.addToClass();
    expect(enroll.enrollByEmail).toHaveBeenLastCalledWith(1,[{email:'anna@wu.at',externalCourseCode:'1268'}]);

    TestBed.resetTestingModule();
    ({c}=setup([]));
    c.addEmail.set('anna@wu.at');
    c.addToClass();
    expect(enroll.enrollByEmail).toHaveBeenLastCalledWith(1,[{email:'anna@wu.at',externalCourseCode:null}]);
  });
});
