import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject, Injectable, isDevMode } from '@angular/core';
import { catchError, from, map, Observable, switchMap } from 'rxjs';

export interface ArchiveGrant {
    ticket: string;
    expiresAt: string;
    totalBytes: number;
    submissions: number;
    recordings: number;
    includeRecordings: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
    private http = inject(HttpClient);
    private base = '/api/export';

    // `studentId` scopes an export to one student: their group's submission,
    // the evaluations it received, and the evaluations they gave.
    private scopePath(assignmentId: number, studentId?: number | null): string {
        return `${this.base}/assignment/${assignmentId}` + (studentId ? `/student/${studentId}` : '');
    }

    downloadEvaluationsCsv(assignmentId: number, studentId?: number | null) {
        const fallback = `peerofessor-assignment-${assignmentId}${studentId ? `-student-${studentId}` : ''}-evaluations.csv`;
        return this.http.get(`${this.scopePath(assignmentId, studentId)}/evaluations.csv`, {
            observe: 'response', responseType: 'blob',
        }).pipe(
            switchMap(res => from(this.save(res, 'csv', fallback))),
            catchError(err => from(this.downloadFailure(err)))
        );
    }

    // Bulk ZIP: a native browser download, not an XHR blob. Real assignments
    // (many submissions + up to 200 MB recordings) are too big to hold in tab
    // memory, and a blob shows no progress. So: trade the Bearer token for a
    // single-use, 60 s ticket (the server validates and plans the archive in
    // that call, so any error comes back here as JSON), then let a hidden
    // iframe fetch the ticket URL. The browser streams it to disk with its own
    // progress bar. `onRefused` gets the server's reason if the ticket URL is
    // refused (expired/reused/permission) instead of starting a download.
    downloadAssignmentArchive(assignmentId: number, opts: { recordings: boolean; studentId?: number | null } = { recordings: true },
                              onRefused?: (message: string) => void): Observable<ArchiveGrant> {
        return this.http.post<ArchiveGrant & { ok?: boolean; error?: string }>(`${this.scopePath(assignmentId, opts.studentId)}/archive-ticket`, {
            recordings: opts.recordings,
        }).pipe(
            map(grant => {
                if (grant?.ok === false) throw new Error(grant.error || 'Could not prepare the download.');
                if (!grant?.ticket) throw new Error('The server did not return a download link. Please try again.');
                this.startNativeDownload(`${this.base}/archive/${encodeURIComponent(grant.ticket)}`, onRefused);
                return grant;
            }),
            catchError(err => from(this.downloadFailure(err)))
        );
    }

    // Successful downloads (Content-Disposition: attachment) never replace the
    // frame's document; only a plain-text refusal does, which we read back
    // (same origin). Frames stay in <body> so a running download survives SPA
    // navigation; each one is removed once it has shown a refusal.
    private startNativeDownload(url: string, onRefused?: (message: string) => void): void {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.setAttribute('aria-hidden', 'true');
        frame.addEventListener('load', () => {
            let text = '';
            try { text = frame.contentDocument?.body?.textContent?.trim() ?? ''; } catch {}
            if (!text) return;
            if (isDevMode()) console.error('Peerofessor export refused:', text);
            onRefused?.(text);
            frame.remove();
        });
        frame.src = url;
        document.body.appendChild(frame);
    }

    private async save(res: HttpResponse<Blob>, format: 'csv', fallback: string): Promise<void> {
        const blob = res.body;
        const type = (res.headers.get('Content-Type') || blob?.type || '').split(';')[0].toLowerCase();
        if (!blob || !blob.size) throw new Error('The export response was empty.');
        if (type.includes('json')) {
            const body = await blob.text();
            let message = 'The server returned an error instead of the requested export.';
            try { const error = JSON.parse(body); message = error.error || error.message || message; } catch {}
            throw new Error(message);
        }
        if (!['text/csv', 'text/plain', 'application/octet-stream'].includes(type)) {
            throw new Error('The server did not return a CSV export.');
        }
        this.saveBlob(blob, this.filenameFrom(res, format, fallback));
    }

    private filenameFrom(res: HttpResponse<Blob>, extension: string, fallback: string): string {
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        const plain = /filename=(?:"([^"]+)"|([^;]+))/i.exec(disposition);
        let name = plain?.[1] ?? plain?.[2] ?? fallback;
        if (encoded) { try { name = decodeURIComponent(encoded[1]); } catch {} }
        name = name.split(/[\\/]/).pop()!.trim();
        return name.toLowerCase().endsWith(`.${extension}`) ? name : fallback;
    }

    private async downloadFailure(err: unknown): Promise<never> {
        let message = err instanceof Error ? err.message : 'Could not download the export.';
        if (err instanceof HttpErrorResponse) {
            let body = err.error;
            if (body instanceof Blob) { try { body = JSON.parse(await body.text()); } catch {} }
            message = body?.error || body?.message || 'Could not download the export. Please try again.';
        }
        if (isDevMode()) console.error('Peerofessor export failed:', message);
        throw new Error(message);
    }

    private saveBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
}
