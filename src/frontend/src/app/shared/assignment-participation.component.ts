import {Component,Input,Output,EventEmitter,inject,signal,OnChanges} from '@angular/core';
import {AssignmentWorkflowService,Participant} from '../core/services/assignment-workflow.service';
@Component({
  selector:'app-assignment-participation',standalone:true,
  template:`
    <div class="section-label">Participation — {{assignmentName}}</div>
    <p>Evaluees are grouped, submit work, and receive peer evaluations.<br>Evaluators are eligible to perform peer evaluations.</p>
    @if(error()){<p role="alert" class="error">{{error()}}</p>}
    @if(loading()){<p role="status">Loading participation…</p>}
    <div class="table-scroll"><table>
      <thead><tr><th>Participant</th><th>Evaluee / group member</th><th>Evaluator</th></tr></thead>
      <tbody>@for(p of participants();track p.id){<tr>
        <td>{{p.username}} <small>{{p.role}} · {{p.email}}</small></td>
        <td><input type="checkbox" [checked]="p.evalueeEligible" [disabled]="saving()" [attr.aria-label]="p.username + ' evaluee / group member'"
          (change)="save(p,'evalueeEligible',$any($event.target).checked,$any($event.target))"></td>
        <td><input type="checkbox" [checked]="p.evaluatorEligible" [disabled]="saving()" [attr.aria-label]="p.username + ' evaluator'"
          (change)="save(p,'evaluatorEligible',$any($event.target).checked,$any($event.target))"></td>
      </tr>}</tbody>
    </table></div>`,
  styles:[`.section-label{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;margin-top:16px}p,small{font-size:.8rem;color:oklch(65% .01 272)}small{display:block}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:.85rem}td,th{padding:10px;border-bottom:1px solid oklch(25% .025 272)}input{accent-color:oklch(75% .15 200)}.error{color:oklch(75% .18 25)}`]
})
export class AssignmentParticipationComponent implements OnChanges {
  @Input({required:true}) assignmentId!:number;
  @Input() assignmentName='';
  @Output() changed=new EventEmitter<Participant[]>();
  private service=inject(AssignmentWorkflowService);
  participants=signal<Participant[]>([]);loading=signal(false);saving=signal(false);error=signal<string|null>(null);
  ngOnChanges(){this.loading.set(true);this.error.set(null);this.service.participation(this.assignmentId).subscribe({
    next:r=>{this.participants.set(r.participants);this.changed.emit(r.participants);this.loading.set(false);},
    error:e=>{this.error.set(e?.error?.error??'Could not load participation.');this.loading.set(false);}
  });}
  save(p:Participant,key:'evalueeEligible'|'evaluatorEligible',value:boolean,input?:HTMLInputElement){
    if(input) input.checked=p[key];
    this.saving.set(true);this.error.set(null);
    this.service.saveParticipation(this.assignmentId,[{userId:p.id,[key]:value}]).subscribe({
      next:r=>{this.participants.set(r.participants);this.changed.emit(r.participants);this.saving.set(false);},
      error:e=>{this.error.set(e?.error?.error??'Could not save participation.');this.participants.update(ps=>ps.map(p=>({...p})));this.saving.set(false);}
    });
  }
}
