import { Component, EventEmitter, inject, Output, signal } from "@angular/core";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { DS } from "../tokens";
import { FieldType } from "./field.types";
import { FieldComponent } from "./field.component";
import { BtnComponent } from "./btn.component";
import { AuthService } from "../services/auth.service";
import { CourseService } from "../core/services/course-service/course-service";
import { LoadingService } from "../core/services/loading-service/loading.service";

@Component({
    selector: 'app-create-class',
    standalone: true,
    imports: [FieldComponent, BtnComponent, TranslateModule],
    template: `
        <div class="page">


            <div class="card">
                <div class="card-body">
                    <div class="fields-scroll">
                            <div class="fields">
                                @for (field of infoFields; track field.label) {
                                    <app-field [field]="field" [isEditing]="true"
                                        (valueChanged)="onFieldChanged($event)" />
                                }
                            </div>
                        @if (error()) {
                            <div class="error">{{ error() }}</div>
                        }
                    </div>
                </div>

                <div class="actions">
                    <app-btn variant="ghost"   size="lg" (clicked)="onCancel()">{{ 'btn_cancel' | translate }}</app-btn>
                    <app-btn variant="primary" size="lg" (clicked)="onSave()">{{ 'btn_create_class' | translate }}</app-btn>
                </div>
            </div>

        </div>
    `,
    styles: [`
        .page {
            max-width: 560px;
            margin: 0 auto;
            padding: ${DS.space[6]};
            display: flex;
            flex-direction: column;
            gap: ${DS.space[4]};
        }
        .card {
            display: flex;
            flex-direction: column;
            height: 480px;
            background: ${DS.colors.surface};
            border: 1px solid ${DS.colors.border};
            border-radius: ${DS.radius.xl};
            overflow: hidden;
        }
        .card-body {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .fields-scroll {
            flex: 1;
            overflow-y: auto;
            padding: ${DS.space[3]};
            display: flex;
            flex-direction: column;
            gap: ${DS.space[3]};
        }
        .fields {
            display: flex;
            flex-direction: column;
            gap: ${DS.space[3]};
        }
        .actions {
            flex-shrink: 0;
            display: flex;
            justify-content: flex-end;
            gap: ${DS.space[2]};
            padding: ${DS.space[3]} ${DS.space[4]};
            border-top: 1px solid ${DS.colors.borderSubtle};
            background: ${DS.colors.surface};
        }
        .error {
            font-size: 0.8125rem;
            color: ${DS.colors.red};
            background: ${DS.colors.redSubtle};
            border: 1px solid ${DS.colors.redBorder};
            border-radius: ${DS.radius.md};
            padding: ${DS.space[2]} ${DS.space[3]};
        }
        .threshold-hint {
            font-size: 0.8125rem;
            color: ${DS.colors.fg2};
            background: ${DS.colors.violetSubtle};
            border: 1px solid ${DS.colors.violetBorder};
            border-radius: ${DS.radius.md};
            padding: ${DS.space[2]} ${DS.space[3]};
        }
    `]
})
export class CreateClassPage {
    private auth      = inject(AuthService);
    private courses   = inject(CourseService);
    private loading   = inject(LoadingService);
    private translate = inject(TranslateService);

    @Output() saved     = new EventEmitter<void>();
    @Output() cancelled = new EventEmitter<void>();

    error     = signal<string | null>(null);

    private changes = new Map<string, FieldType>();

    infoFields: FieldType[] = [
        { type: 'text',      label: 'bocal_label_class_name',     icon: 'title',       required: true,  allowEdit: true, value: undefined },
        { type: 'text', label: 'Term', icon:'event', required:false, allowEdit:true, value:'' },
        { type: 'text', label: 'Official course numbers (comma-separated)', icon:'tag', required:true, allowEdit:true, value:'' },
        { type: 'text-area', label: 'field_description',          icon: 'description', required: true,  allowEdit: true, value: undefined },
    ];


    onFieldChanged(field: FieldType) {
        this.changes.set(field.label, field);
    }

    getValue(label: string): any {
        const changed = this.changes.get(label);
        if (changed !== undefined) return changed.value;
        return this.infoFields.find(f => f.label === label)?.value;
    }

    onSave() {
        const name      = this.getValue('bocal_label_class_name') as string | undefined;
        const desc      = this.getValue('field_description') as string | undefined;
        // Preserve the previous Create Course value for API compatibility; grading uses Assignment.pass_threshold.
        const threshold = 80;

        const externalCourseCodes = String(this.getValue('Official course numbers (comma-separated)') ?? '').split(/[,\n]/).map(c=>c.trim()).filter(Boolean);

        if (!name?.trim()) { this.error.set(this.translate.instant('error_class_name_required')); return; }
        if (!externalCourseCodes.length) { this.error.set(this.translate.instant('error_course_numbers_required')); return; }
        if (!desc?.trim()) { this.error.set(this.translate.instant('error_description_required')); return; }

        const user = this.auth.user();
        if (!user?.orgId) { this.error.set(this.translate.instant('error_account_not_linked_org')); return; }

        this.error.set(null);
        this.loading.show();
        this.courses.createClass({
            term: String(this.getValue('Term') ?? '').trim() || null,
            externalCourseCodes,
            name:           name.trim(),
            description:    desc.trim(),
            pass_threshold: threshold,
            org_id:         user.orgId,
            created_by:     user.id,
        }).subscribe({
            next: () => {
                this.loading.hide();
                this.changes.clear();
                this.saved.emit();
            },
            error: (err) => {
                this.loading.hide();
                this.error.set(err?.error?.error ?? err?.error?.message ?? this.translate.instant('error_create_class_failed'));
            },
        });
    }

    onCancel() {
        this.changes.clear();
        this.error.set(null);
        this.cancelled.emit();
    }
}
