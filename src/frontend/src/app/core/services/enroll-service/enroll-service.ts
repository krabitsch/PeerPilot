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


export interface RosterRow {
  email: string;
  externalCourseCode?: string | null;
}

// One result per submitted row. `account`: 'created' / 'pending' means the
// student has not signed up yet; signing up with this email claims the account.
export interface RosterResult {
  email: string;
  externalCourseCode: string | null;
  status: 'enrolled' | 'updated' | 'unchanged' | 'failed';
  account?: 'created' | 'pending' | 'registered';
  userId?: number;
  error?: string;
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
    // Students supply a university course number; staff enroll without one.
    externalCourseCode?: string;
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


  // Staff only: enroll by email, creating pending accounts for emails that
  // have not signed up yet.
  enrollByEmail(
    classId: number,
    students: RosterRow[]
  ) {
    return this.http.post<{ results: RosterResult[] }>(
      `${this.base}/class/${classId}/students`,
      { students }
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