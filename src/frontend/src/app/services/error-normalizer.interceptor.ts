import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler,
  HttpEvent, HttpResponse, HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, of, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';

// The backend always returns HTTP 200, using { ok: false, code, error } in the
// body to signal failures. This interceptor converts those responses into proper
// HttpErrorResponse objects so every catchError handler and the AuthInterceptor
// continue to work without any changes.
@Injectable()
export class ErrorNormalizerInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      switchMap((event: HttpEvent<any>) => {
        if (event instanceof HttpResponse) {
          // Binary export requests also receive the API's JSON error envelopes.
          // Decode them before AuthInterceptor so expired sessions can refresh.
          const type = event.headers.get('Content-Type') || event.body?.type || '';
          if (event.body instanceof Blob && type.includes('json')) {
            return from(event.body.text()).pipe(switchMap(text => {
              let body;
              try { body = JSON.parse(text); } catch { return of(event); }
              return this.normalize(event, body, req.url);
            }));
          }
          return this.normalize(event, event.body, req.url);
        }
        return of(event);
      }),
    );
  }
  private normalize(event: HttpResponse<any>, body: any, url: string): Observable<HttpEvent<any>> {
    return body?.ok === false ? throwError(() => new HttpErrorResponse({
      error: body, status: body.code || 400, statusText: body.error || 'Error', url,
    })) : of(event);
  }

}
