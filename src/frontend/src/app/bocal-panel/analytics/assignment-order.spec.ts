import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting,HttpTestingController} from '@angular/common/http/testing';
import {AssignmentService} from '../../core/services/course-service/Assignment.service';
describe('analytics assignment ordering',()=>{
  it('uses creation timestamps and IDs rather than names or server order',()=>{
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
    let ids:number[]=[];
    TestBed.inject(AssignmentService).getAssignments(4).subscribe(rows=>ids=rows.map(r=>r.id));
    TestBed.inject(HttpTestingController).expectOne('/api/class/4/assignments').flush([
      {id:3,name:'Assignment 1',created_at:'2026-10-02'},
      {id:2,name:'Assignment 2',created_at:'2026-10-01'},
      {id:1,name:'Assignment 3',created_at:'2026-10-01'},
    ]);
    expect(ids).toEqual([1,2,3]);
    TestBed.inject(HttpTestingController).verify();
  });
});
