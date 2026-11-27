import {followDownload} from './download';

describe('followDownload',()=>{
  afterEach(()=>vi.restoreAllMocks());

  it('follows the presigned link in the current tab, never via a popup',()=>{
    const open=vi.spyOn(window,'open').mockImplementation(()=>null);
    let clicked:HTMLAnchorElement|null=null;
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){clicked=this;});
    followDownload('https://example.test/files/submissions/abc?X-Amz-Signature=1');
    expect(clicked).not.toBeNull();
    expect(clicked!.href).toBe('https://example.test/files/submissions/abc?X-Amz-Signature=1');
    expect(clicked!.target).toBe('');
    expect(clicked!.isConnected).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
