import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { EvalResponse, EvaluationOutcome } from "../../../tokens";


// ============================================================
// EvalAssignment
// ============================================================

// EvalAssignment object as returned by the backend.
export interface EvalAssignment {
  id: number;

  assignmentId: number;

  evalueeGroupId: number;

  evaluatorUserId: number;

  evaluatorGroupId: number | null;

  round: number;

  status: EvalAssignmentStatus;

  submissionId: number | null;

  evalResponseId: number | null;

  createdAt: string;

  // One passkey per evaluation pairing.
  //
  // Nullable because old EvalAssignment rows created before
  // the passkey migration can temporarily contain null.
  passKey: string | null;
  retryRequested: boolean;
  retryRequestedAt: string | null;
  outcome?: EvaluationOutcome;
  studentOutcome?: EvaluationOutcome;
  evalResponse?: { id: number; givenMarks: number; coreScore?: number | null; bonusScore?: number; subId: number; userId: number; isStaffReview: boolean; reply: string | null } | null;

  // Returned directly by the Eval API so student-facing pages
  // do not need another User API request just to display the
  // evaluator name.
  evaluatorUser?: {
    id: number;
    username: string;
    email?: string;
  };
}


export interface EvaluatorTask {
  id: number;
  assignmentId: number;
  evalueeGroupId: number;
  round: number;
  status: EvalAssignmentStatus;
  assignment: { evaluationDeadline?: string | null; id: number; name: string; created_at: string; classid: number; max_score?:number; pass_threshold?:number; evaluationDurationMinutes?: number };
  evalueeGroup: { id: number; name: string; members: { user: { id: number; username: string; email?: string } }[] };
  evalResponse: {
    id: number; givenMarks: number; coreScore?: number | null; bonusScore?: number; comment: string; reply: string | null;
    scores: { sectionId: number; score: number; section: { name: string; marks: number; isBonus?: boolean; sortOrder?: number } }[];
  } | null;
}

export interface EvaluatorTaskOverview {
  courses: {
    id: number; name: string; description: string; term: string | null; created_at: string;
    assignments: { id: number; name: string; created_at: string }[];
  }[];
  tasks: EvaluatorTask[];
}

// Request body for manually creating one EvalAssignment.
export interface CreateEvalAssignmentPayload {
  assignmentId: number;

  evalueeGroupId: number;

  evaluatorUserId: number;

  evaluatorGroupId?: number | null;

  round: number;

  submissionId?: number | null;

  evalResponseId?: number | null;
}


// Request body for updating an EvalAssignment.
export interface UpdateEvalAssignmentPayload {
  assignmentId?: number;

  evalueeGroupId?: number;

  evaluatorUserId?: number;

  evaluatorGroupId?: number | null;

  round?: number;

  status?: EvalAssignmentStatus;

  submissionId?: number | null;

  evalResponseId?: number | null;
}


// ============================================================
// Evaluation workflow responses
// ============================================================

export interface StartEvaluationResponse {
  evalAssignmentId: number;

  assignment: { evaluationDeadline?: string | null;
    id: number;
    name: string;
    description: string;
    max_score: number;
    pass_threshold?: number;
    evaluationDurationMinutes?: number;
  };

  group: {
    id: number;
    name: string;
  };

  submission: {
    id: number;
    files?: {id:number;name:string;url:string;size:number}[];

    file: {
      id: number;
      name: string;
      url: string;
      size: number;
    } | null;
  };

  evalSheet: EvalSheet;
}


export interface SubmitEvaluationResponse {
  id: number;

  subId: number;

  userId: number;

  givenMarks: number;

  comment: string;
}


// ============================================================
// Evaluation types
// ============================================================

// Mirrors enum EvalAssignmentStatus in schema.prisma.
export type EvalAssignmentStatus =
  | 'Pending'
  | 'Submitted'
  | 'Cancelled';


export type EvalSectionType =
  | 'Toggle'
  | 'Slider';


export interface EvalSection {
  id: number;

  name: string;

  description: string;

  marks: number;

  sectionType: EvalSectionType;
  sortOrder?: number;
  isBonus?: boolean;

  evalSheetId: number;
}


export interface EvalSheet {
  id: number;

  assId: number;

  sections: EvalSection[];
}


// ============================================================
// Service
// ============================================================

@Injectable({
  providedIn: "root"
})
export class EvalService {

  private http =
    inject(HttpClient);

  private base =
    '/api/eval';


  // ----------------------------------------------------------
  // EvalSheet routes
  // ----------------------------------------------------------

  getEvalSheet(
    id: number
  ) {
    return this.http.get<EvalSheet>(
      `${this.base}/sheet/${id}`
    );
  }


  getEvalSheetByAssignment(
    assignmentId: number
  ) {
    return this.http.get<EvalSheet>(
      `${this.base}/sheet/ass/${assignmentId}`
    );
  }


  createEvalSheet(
    assId: number
  ) {
    return this.http.post<EvalSheet>(
      `${this.base}/sheet`,
      {
        assId
      }
    );
  }


    submitEvaluation(data: { evalAssignmentId: number, comment: string, scores: { sectionId: number, score: number }[] }) {
        return this.http.post<SubmitEvaluationResponse>(`${this.base}/evaluate/submit`, data)
    }

    // Presigned URL to play/download an evaluation's recording (access-gated server-side).
    getRecordingUrl(responseId: number) {
        return this.http.get<{ url: string }>(`${this.base}/responses/${responseId}/recording`)
    }

  createSection(
    sheetId: number,
    data: {
      name: string;
      description: string;
      marks: number;
      sectionType: EvalSectionType;
      sortOrder?: number;
      isBonus?: boolean;
    }
  ) {
    return this.http.post<EvalSection>(
      `${this.base}/sheet/${sheetId}/section`,
      data
    );
  }


  updateSection(
    sheetId: number,
    data: {
      secId: number;
      name?: string;
      description?: string;
      marks?: number;
      sectionType?: EvalSectionType;
      sortOrder?: number;
      isBonus?: boolean;
    }
  ) {
    return this.http.patch<EvalSection>(
      `${this.base}/sheet/${sheetId}/section`,
      data
    );
  }


  saveSections(sheetId: number, sections: { id?: number; name: string; description: string; marks: number; sectionType: EvalSectionType; isBonus?: boolean }[]) {
    return this.http.patch<EvalSheet>(`${this.base}/sheet/${sheetId}/section`, { sections });
  }

  removeSection(
    sheetId: number,
    secId: number
  ) {
    return this.http.delete<{
      message: string;
      id: number;
    }>(
      `${this.base}/sheet/${sheetId}/section`,
      {
        body: {
          secId
        }
      }
    );
  }


  getAssignment(
    id: number
  ) {
    return this.http.get(
      `${this.base}/assignment/${id}`
    );
  }


  // ----------------------------------------------------------
  // EvalAssignment routes
  // ----------------------------------------------------------

  createEvalAssignment(
    data: CreateEvalAssignmentPayload
  ) {
    return this.http.post<EvalAssignment>(
      `${this.base}/eval-assignments`,
      data
    );
  }


  getEvalAssignments(
    assignmentId: number
  ) {
    return this.http.get<EvalAssignment[]>(
      `${this.base}/assignment/${assignmentId}/eval-assignments`
    );
  }


  deleteEvalAssignments(
    assignmentId: number
  ) {
    return this.http.delete<{
      message: string;
      assignmentId: number;
      count: number;
    }>(
      `${this.base}/assignment/${assignmentId}/eval-assignments`
    );
  }


  getEvalAssignmentById(
    id: number
  ) {
    return this.http.get<EvalAssignment>(
      `${this.base}/eval-assignments/${id}`
    );
  }


  updateEvalAssignment(
    id: number,
    data: UpdateEvalAssignmentPayload
  ) {
    return this.http.put<EvalAssignment>(
      `${this.base}/eval-assignments/${id}`,
      data
    );
  }


  deleteEvalAssignment(
    id: number
  ) {
    return this.http.delete<{
      message: string;
      id: number;
    }>(
      `${this.base}/eval-assignments/${id}`
    );
  }


  generateSimplePairings(
    assignmentId: number
  ) {
    return this.http.post<{
      message: string;
      assignmentId: number;
      rounds: number;
      count: number;
      evalAssignments: EvalAssignment[];
    }>(
      `${this.base}/assignment/${assignmentId}/generate-simple-pairings`,
      {}
    );
  }


  requestRetry(id: number) {
    return this.http.post<EvalAssignment>(`${this.base}/eval-assignments/${id}/retry`, {});
  }

  // ----------------------------------------------------------
  // Evaluator workflow
  // ----------------------------------------------------------

  getMyEvaluatorTasks() {
    return this.http.get<EvaluatorTaskOverview>(`${this.base}/my-tasks`);
  }

  startEvaluation(
    data: {
      evalAssignmentId: number;
      passkey: string;
    }
  ) {
    return this.http.post<StartEvaluationResponse>(
      `${this.base}/evaluate/start`,
      data
    );
  }


  // ----------------------------------------------------------
  // Feedback
  // ----------------------------------------------------------

  getResponsesForSubmission(
    subId: number
  ) {
    return this.http.get<EvalResponse[]>(
      `${this.base}/submission/${subId}/responses`
    );
  }


  replyToResponse(
    responseId: number,
    data: {
      userId: number;
      reply: string;
      recording?: File;
    }
  ) {
    const form = new FormData();
    form.append('reply', data.reply);
    if (data.recording) form.append('recording', data.recording);
    return this.http.patch<EvalResponse>(`${this.base}/responses/${responseId}/reply`, form);
  }
}