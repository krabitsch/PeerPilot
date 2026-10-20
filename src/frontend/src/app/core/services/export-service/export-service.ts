import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject, Injectable, isDevMode } from '@angular/core';
import { catchError, from, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ExportService {
    private http = inject(HttpClient);
    private base = '/api/export';

    downloadEvaluationsCsv(assignmentId: number) {
        return this.http.get(`${this.base}/assignment/${assignmentId}/evaluations.csv`, {
            observe: 'response', responseType: 'blob',
        }).pipe(
            switchMap(res => from(this.save(res, 'csv', `peerofessor-assignment-${assignmentId}-evaluations.csv`))),
            catchError(err => from(this.downloadFailure(err)))
        );
    }

    downloadAssignmentArchive(assignmentId: number, opts: { recordings: boolean } = { recordings: true }) {
        const params: Record<string, string> = opts.recordings ? {} : { recordings: '0' };
        return this.http.get(`${this.base}/assignment/${assignmentId}/archive`, {
            observe: 'response', responseType: 'blob', params,
        }).pipe(
            switchMap(res => from(this.save(res, 'zip', `peerofessor-assignment-${assignmentId}.zip`))),
            catchError(err => from(this.downloadFailure(err)))
        );
    }

    private async save(res: HttpResponse<Blob>, format: 'zip' | 'csv', fallback: string): Promise<void> {
        const blob = res.body;
        const type = (res.headers.get('Content-Type') || blob?.type || '').split(';')[0].toLowerCase();
        if (!blob || !blob.size) throw new Error('The export response was empty.');
        if (type.includes('json')) {
            const body = await blob.text();
            let message = 'The server returned an error instead of the requested export.';
            try { const error = JSON.parse(body); message = error.error || error.message || message; } catch {}
            throw new Error(message);
        }
        if (format === 'zip') {
            const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
            const isZip = signature[0] === 0x50 && signature[1] === 0x4b &&
                ((signature[2] === 3 && signature[3] === 4) || (signature[2] === 5 && signature[3] === 6) ||
                 (signature[2] === 7 && signature[3] === 8));
            if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(type) || !isZip)
                throw new Error('The server did not return a valid ZIP archive. Please try again.');
        } else if (!['text/csv', 'text/plain', 'application/octet-stream'].includes(type)) {
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
