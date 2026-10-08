import { HttpClient, HttpResponse } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { map } from "rxjs/operators";

// Staff-only bulk downloads for an assignment. Everything here is server-
// generated content fetched as a blob — the auth interceptor adds the Bearer
// token (a plain <a download> couldn't), then saveBlob() hands the file to the
// browser. Single-file downloads (one submission, one recording) stay on the
// presigned-URL pattern in SubmissionService / EvalService.
@Injectable({ providedIn: "root" })
export class ExportService {
    private http = inject(HttpClient)
    private base = '/api/export'

    // Evaluations as a CSV sheet (one row per evaluation).
    downloadEvaluationsCsv(assignmentId: number) {
        return this.http
            .get(`${this.base}/assignment/${assignmentId}/evaluations.csv`, {
                observe: 'response' as const,
                responseType: 'blob' as const,
            })
            .pipe(map(res => this.save(res)))
    }

    // Everything for the assignment as one ZIP: submissions, the evaluations
    // CSV, and (unless recordings === false) the audio recordings.
    downloadAssignmentArchive(assignmentId: number, opts: { recordings: boolean } = { recordings: true }) {
        const params: Record<string, string> = opts.recordings ? {} : { recordings: '0' }
        return this.http
            .get(`${this.base}/assignment/${assignmentId}/archive`, {
                observe: 'response' as const,
                responseType: 'blob' as const,
                params,
            })
            .pipe(map(res => this.save(res)))
    }

    private save(res: HttpResponse<Blob>): void {
        const blob = res.body
        if (!blob) return
        this.saveBlob(blob, this.filenameFrom(res))
    }

    // Pull the server-suggested name out of Content-Disposition, falling back
    // to a generic one.
    private filenameFrom(res: HttpResponse<Blob>): string {
        const disposition = res.headers.get('Content-Disposition') ?? ''
        const match = /filename="?([^"]+)"?/.exec(disposition)
        return match?.[1] ?? 'download'
    }

    private saveBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
    }
}
