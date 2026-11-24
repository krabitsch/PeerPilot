// Starts a browser download of a presigned file URL that the API handed back.
//
// Why not window.open(url, '_blank'): the URL only arrives after an HTTP
// round-trip, so the call is no longer inside the user's click. Safari and
// Firefox popup blockers then silently swallow the new tab, and the button
// appears to do nothing. Presigned links are served with
// `Content-Disposition: attachment` (fileManager getUrl), so following the link
// in the current tab downloads the file and leaves the page where it is, with
// no popup involved.
export function followDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
