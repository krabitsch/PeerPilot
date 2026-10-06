import {
  Component,
  Input,
  ViewEncapsulation,
  inject
} from '@angular/core';

import {
  DomSanitizer,
  SafeHtml
} from '@angular/platform-browser';

import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import DOMPurify from 'dompurify';


@Component({
  selector: 'app-markdown-math',
  standalone: true,

  template: `
    <div
      class="markdown-math"
      [innerHTML]="renderedHtml">
    </div>
  `,

  encapsulation: ViewEncapsulation.None,
})
export class MarkdownMathComponent {

  private sanitizer = inject(DomSanitizer);

  private md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
  }).use(texmath, {
    engine: katex,
    delimiters: 'dollars',

    katexOptions: {
      throwOnError: false,
      trust: false,
      strict: false,
    },
  });


  renderedHtml: SafeHtml = '';


  @Input()
  set text(value: string | null | undefined) {

    const source = value ?? '';

    const rendered = this.md.render(source);

    const clean = DOMPurify.sanitize(rendered);

    this.renderedHtml =
      this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}