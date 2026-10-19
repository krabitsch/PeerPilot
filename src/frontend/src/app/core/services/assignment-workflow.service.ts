import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
export interface Participant {
  id:number; username:string; email:string; role:string;
  evalueeEligible:boolean; evaluatorEligible:boolean;
}
export interface EvaluatorParticipant extends Participant {
  assignmentCount:number; courseCount:number;
}
export interface WorkflowGroup {
  id:number; name:string; eligible:boolean; leaderId:number;
  members:{id:number;userId:number;user:{id:number;username:string;email:string}}[];
}
export interface PairingSlot {
  groupId:number; round:number; kind:'InitialMissing'|'RetryRequired';
  previousEvaluatorIds:number[]; previousEvaluators:string[]; candidateIds:number[];
}
export interface PairingManagement {
  assignment:{id:number;name:string;classid:number;courseName:string;req_eval:number};
  participants:EvaluatorParticipant[];groups:WorkflowGroup[];slots:PairingSlot[];ungrouped:Participant[];
  pairings:{id:number;evalueeGroupId:number;evaluatorUserId:number;evaluatorGroupId:number|null;
    round:number;status:string;outcome:string;evalResponseId:number|null;evaluatorName:string;retryRequested:boolean}[];
}
@Injectable({providedIn:'root'})
export class AssignmentWorkflowService {
  private http=inject(HttpClient);
  private base='/api/eval/assignment';
  participation(id:number){return this.http.get<{participants:Participant[]}>(`${this.base}/${id}/participation`);}
  saveParticipation(id:number,participants:{userId:number;evalueeEligible?:boolean;evaluatorEligible?:boolean}[]){
    return this.http.put<{participants:Participant[]}>(`${this.base}/${id}/participation`,{participants});
  }
  summary(id:number){return this.http.get<PairingManagement>(`${this.base}/${id}/management`);}
  generate(id:number,groupIds:number[],participants:{userId:number;evaluatorEligible:boolean}[]){
    return this.http.post<{count:number;message:string;unfilled:PairingSlot[]}>(`${this.base}/${id}/generate-simple-pairings`,{groupIds,participants});
  }
  create(id:number,slot:PairingSlot,userId:number){return this.http.post('/api/eval/eval-assignments',{
    assignmentId:id,evalueeGroupId:slot.groupId,round:slot.round,evaluatorUserId:userId});}
  cancel(id:number){return this.http.delete(`/api/eval/eval-assignments/${id}`);}
}
