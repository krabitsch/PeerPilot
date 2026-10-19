import {Component,computed,inject,signal,OnInit} from '@angular/core';
import {ActivatedRoute,Router} from '@angular/router';
import {FormsModule} from '@angular/forms';
import {ContainerComponent,ContainerConfig} from '../shared/container.component';
import {BtnComponent} from '../shared/btn.component';
import {AssignmentWorkflowService,PairingManagement,PairingSlot,EvaluatorParticipant} from '../core/services/assignment-workflow.service';
import {EvalService} from '../core/services/eval-service/eval-service';
@Component({
  selector:'app-eval-assignment-list',standalone:true,imports:[FormsModule,ContainerComponent,BtnComponent],
  templateUrl:'./eval-assignment-list.component.html',
  styles:[`
    :host{display:block;width:100%}.page{padding:32px;display:flex;flex-direction:column;gap:20px;height:100vh;overflow:auto;box-sizing:border-box}
    .heading,.actions,.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.actions{justify-content:flex-start}
    h1{font-size:1.75rem;margin:8px 0}h2{font-size:1.15rem}.section-label{text-transform:uppercase;letter-spacing:.08em;font-size:.75rem;color:oklch(75% .15 200)}
    .muted,small{font-size:.82rem;color:oklch(65% .01 272)}small{display:block;margin-top:4px}.content{padding:20px}.row{padding:12px 0;border-bottom:1px solid oklch(25% .025 272)}
    .overlay{position:fixed;inset:0;background:oklch(0% 0 0 / .7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:100}
    .modal{background:oklch(15% .025 272);border:1px solid oklch(25% .025 272);border-radius:16px;padding:28px;width:min(850px,95vw);max-height:90vh;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:16px}
    .table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:.85rem}th,td{padding:10px;border-bottom:1px solid oklch(25% .025 272)}
    select{width:100%;padding:10px;margin:6px 0 12px;background:oklch(12% .025 272);border:1px solid oklch(30% .025 272);border-radius:8px;color:inherit}
    input{accent-color:oklch(75% .15 200)}.error{color:oklch(75% .18 25)}.notice{color:oklch(80% .12 160)}label{font-size:.85rem}
  `]
})
export class EvalAssignmentListComponent implements OnInit {
  private route=inject(ActivatedRoute);private router=inject(Router);
  private workflow=inject(AssignmentWorkflowService);private eval=inject(EvalService);
  data=signal<PairingManagement|null>(null);assignmentId=signal(0);
  loading=signal(false);error=signal<string|null>(null);notice=signal<string|null>(null);
  modal=signal<'generate'|'single'|'counts'|'queue'|null>(null);
  groupIds=signal<number[]>([]);pool=signal<EvaluatorParticipant[]>([]);slotKey=signal('');evaluatorId=signal<number|null>(null);
  selectedRound=signal(1);
  workloadSort=signal<'course'|'assignment'|'username'>('course');
  readonly card:ContainerConfig={variant:'flat',height:'auto',scrollable:false};
  rounds=computed(()=>[...new Set((this.data()?.pairings??[]).map(p=>p.round))].sort((a,b)=>a-b));
  rows=computed(()=>this.data()?.pairings.filter(p=>p.round===this.selectedRound())??[]);
  selectedSlot=computed(()=>this.data()?.slots.find(s=>this.key(s)===this.slotKey())??null);
  candidates=computed(()=>{
    const ids=this.selectedSlot()?.candidateIds??[];
    return ids.map(id=>this.data()!.participants.find(p=>p.id===id)!).filter(Boolean);
  });
  counts=computed(()=>[...(this.data()?.participants??[])].sort((a,b)=>
    (this.workloadSort()==='username'?a.username.localeCompare(b.username):this.workloadSort()==='assignment'?
      a.assignmentCount-b.assignmentCount:a.courseCount-b.courseCount)||a.assignmentCount-b.assignmentCount||a.id-b.id));
  ngOnInit(){this.route.queryParams.subscribe(params=>{
    const id=Number(params['assignmentId']??params['assId']);
    if(!Number.isSafeInteger(id)||id<=0){this.error.set('A valid assignment is required.');return;}
    this.assignmentId.set(id);this.load();
  });}
  load(after?:()=>void){this.loading.set(true);this.error.set(null);this.workflow.summary(this.assignmentId()).subscribe({
    next:data=>{this.data.set(data);if(!this.rounds().includes(this.selectedRound())) this.selectedRound.set(this.rounds()[0]??1);this.loading.set(false);after?.();},
    error:e=>this.failed(e)
  });}
  key(s:PairingSlot){return `${s.groupId}:${s.round}`;}
  groupName(id:number){const g=this.data()?.groups.find(g=>g.id===id);return g?`${g.name}: ${g.members.map(m=>m.user.username).join(', ')}`:`Group ${id}`;}
  slotLabel(s:PairingSlot){return `Round ${s.round} — ${s.kind==='RetryRequired'?'Retry required':'Initial pairing missing'}`;}
  open(modal:'generate'|'single'|'counts'|'queue'){
    this.notice.set(null);this.load(()=>{
      this.groupIds.set(this.data()!.groups.filter(g=>g.eligible).map(g=>g.id));
      this.pool.set(this.data()!.participants.map(p=>({...p})));
      this.slotKey.set(this.data()!.slots[0]?this.key(this.data()!.slots[0]):'');this.chooseSlot();this.modal.set(modal);
    });
  }
  chooseSlot(){this.evaluatorId.set(this.candidates()[0]?.id??null);}
  toggleGroup(id:number,use:boolean){this.groupIds.update(ids=>use?[...ids,id]:ids.filter(i=>i!==id));}
  toggleEvaluator(id:number,use:boolean){this.pool.update(ps=>ps.map(p=>p.id===id?{...p,evaluatorEligible:use}:p));}
  generate(){this.loading.set(true);this.error.set(null);this.workflow.generate(this.assignmentId(),this.groupIds(),
    this.pool().map(p=>({userId:p.id,evaluatorEligible:p.evaluatorEligible}))).subscribe({
      next:r=>{this.modal.set(null);this.notice.set(r.message);this.load();},error:e=>this.failed(e)
    });}
  create(){const slot=this.selectedSlot(),id=this.evaluatorId();if(!slot||!id)return;
    this.loading.set(true);this.error.set(null);this.workflow.create(this.assignmentId(),slot,id).subscribe({
      next:()=>{this.modal.set(null);this.notice.set('Pairing created with its own evaluation passkey.');this.load();},error:e=>this.failed(e)
    });}
  cancel(id:number){if(!window.confirm('Cancel this pending pairing? Its history will be retained and the round will need a new evaluator.'))return;
    this.loading.set(true);this.workflow.cancel(id).subscribe({next:()=>this.load(),error:e=>this.failed(e)});}
  recording(id:number){this.eval.getRecordingUrl(id).subscribe({next:r=>window.open(r.url,'_blank','noopener'),error:e=>this.failed(e)});}
  back(){this.router.navigate(['/bocal/classes'],{queryParams:{classId:this.data()?.assignment.classid}});}
  private failed(e:any){this.error.set(e?.error?.error??e?.error?.message??'Could not complete this action.');this.loading.set(false);}
}
