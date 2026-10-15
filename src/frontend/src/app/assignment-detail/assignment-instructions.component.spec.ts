import { TestBed } from '@angular/core/testing';
import { AssignmentInstructionsComponent } from './assignment-instructions.component';
const file = { id:1,name:'questions.docx',url:'https://localhost/files/assignment-subjects/questions.docx',size:100,mimiType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
describe('unified assignment instructions', () => {
  for (const [name, description, attached] of [
    ['description and file', 'Answer the questions below.', file],
    ['description only', 'Answer the questions below.', null],
    ['file only', '', file],
  ] as const) {
    it(`renders exactly one instructions area for ${name}`, async () => {
      await TestBed.configureTestingModule({imports:[AssignmentInstructionsComponent]}).compileComponents();
      const fixture=TestBed.createComponent(AssignmentInstructionsComponent);
      fixture.componentRef.setInput('assignment',{description,file:attached});fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('[data-testid="assignment-instructions"]').length).toBe(1);
      expect(fixture.nativeElement.querySelectorAll('a').length).toBe(attached?1:0);
      if(attached) expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe(file.url);
      if(!description) expect(fixture.nativeElement.textContent).toContain('The assignment questions are provided in the attached file.');
      else expect(fixture.nativeElement.textContent).toContain(description);
      expect(fixture.nativeElement.textContent).not.toContain('View subject');
      expect(fixture.nativeElement.textContent).not.toContain('Download assignment instructions');
    });
  }
});
