import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { Course } from '../../../tokens';


export interface EnrollmentEligibility {
  eligible: boolean;

  allowedExternalCourseCode:
    string | null;

  availableExternalCourseCodes:
    string[];

  term:
    string | null;
}


@Injectable({
  providedIn: 'root'
})
export class EnrollService {

  private base = '/api/enroll';

  private http = inject(HttpClient);


  enrollStudent(data: {
    classId: number;
    studentId: number;
    externalCourseCode: string;
  }) {

    const {
      studentId,
      ...payload
    } = data;

    return this.http.post(
      `${this.base}/${studentId}`,
      payload
    );
  }


  dropStudent(data: {
    classId: number;
    studentId: number;
  }) {
    return this.http.patch(
      `${this.base}/`,
      data
    );
  }


  getStudentEnrollements(
    studentId: number
  ) {
    return this.http.get(
      `${this.base}/${studentId}`
    );
  }


  getStudenEnrolledClasses(
    studentId: number
  ) {
    return this.http.get<Course[]>(
      `${this.base}/classes/${studentId}`
    );
  }


  getEnrollmentEligibility(
    classId: number,
    studentId: number
  ) {
    return this.http.get<EnrollmentEligibility>(
      `${this.base}/eligibility/${classId}/${studentId}`
    );
  }
}