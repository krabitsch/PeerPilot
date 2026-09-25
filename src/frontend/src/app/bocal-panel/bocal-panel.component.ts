import { Component } from '@angular/core';
import { NgStyle } from '@angular/common';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-bocal-panel',
  standalone: true,
  imports: [
    NgStyle,
    RouterOutlet,
  ],
  templateUrl: './bocal-panel.component.html',
})
export class BocalPanelComponent {

  readonly pageStyle = {
    flex: '1',
    overflowY: 'auto',
    padding: '32px',
  };

}