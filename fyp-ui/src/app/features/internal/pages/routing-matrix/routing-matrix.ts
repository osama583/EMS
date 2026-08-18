import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FLAT_DEPARTMENT_WORKFLOWS, UNIT_DEPARTMENT_WORKFLOWS } from '../../../../core/departments/department-workflow.config';

// Unified display row shape for this read-only visualization page — combines
// UNIT_DEPARTMENT_WORKFLOWS (identified by unitCode) and FLAT_DEPARTMENT_WORKFLOWS (cfo,
// identified by its flat role_code) into one list so the template doesn't need to know which
// underlying shape each row came from.
interface RoutingMatrixRow {
  readonly key: string;
  readonly ownerLabel: string;
  readonly requestKinds: readonly string[];
  readonly optionKinds: readonly string[];
}

@Component({
  selector: 'app-routing-matrix',
  standalone: true,
  template: `
    <div class="routing-matrix">
      <header class="routing-matrix__header">
        <div>
          <h2>Routing Matrix</h2>
          <p>Read-only visualization of department routing — Service department units (identified by unit code) plus the two flat-role departments (CFO, Cafeteria Manager).</p>
        </div>
      </header>

      <div class="routing-matrix__grid">
        @for (workflow of rows; track workflow.key) {
          <div class="routing-matrix__card">
            <h3>{{ workflow.ownerLabel }}</h3>

            <dl class="routing-matrix__details">
              <div>
                <dt>Request Kinds Handled</dt>
                <dd>
                  <ul class="routing-matrix__list">
                    @for (kind of workflow.requestKinds; track kind) {
                      <li>{{ formatKind(kind) }}</li>
                    }
                    @if (workflow.requestKinds.length === 0) {
                      <li>None</li>
                    }
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Dropdown Settings Owned</dt>
                <dd>
                  <ul class="routing-matrix__list">
                    @for (kind of workflow.optionKinds; track kind) {
                      <li>{{ formatKind(kind) }}</li>
                    }
                    @if (workflow.optionKinds.length === 0) {
                      <li>None</li>
                    }
                  </ul>
                </dd>
              </div>
            </dl>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; padding: 2rem; max-width: 60rem; margin: 0 auto; box-sizing: border-box; }
    .routing-matrix { display: grid; gap: 2.5rem; }
    .routing-matrix__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--apu-border); padding-bottom: 1.5rem; }
    .routing-matrix__header h2 { margin: 0 0 .25rem; font-size: 1.75rem; color: var(--apu-navy-950); letter-spacing: -.025em; }
    .routing-matrix__header p { margin: 0; color: var(--apu-text-muted); font-size: 1rem; }

    .routing-matrix__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); gap: 1.5rem; }
    .routing-matrix__card { padding: 1.5rem; background: #fff; border: 1px solid var(--apu-border); border-radius: 1rem; box-shadow: 0 1px 3px rgb(0 0 0 / 4%); display: flex; flex-direction: column; gap: 1rem; }
    .routing-matrix__card h3 { margin: 0; font-size: 1.15rem; color: var(--apu-blue-700); border-bottom: 1px dashed var(--apu-border); padding-bottom: .75rem; }

    .routing-matrix__details { display: grid; gap: 1rem; margin: 0; }
    .routing-matrix__details > div { display: grid; gap: .25rem; }
    .routing-matrix__details dt { font-size: .78rem; font-weight: 700; color: var(--apu-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    .routing-matrix__details dd { margin: 0; font-size: .95rem; color: var(--apu-navy-900); }

    .routing-matrix__list { margin: 0; padding-left: 1.25rem; }
    .routing-matrix__list li { padding: .15rem 0; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutingMatrixComponent {
  readonly rows: readonly RoutingMatrixRow[] = [
    ...UNIT_DEPARTMENT_WORKFLOWS.map((workflow) => ({
      key: workflow.unitCode,
      ownerLabel: this.formatUnitCode(workflow.unitCode),
      requestKinds: workflow.requestKinds,
      optionKinds: workflow.optionKinds,
    })),
    ...FLAT_DEPARTMENT_WORKFLOWS.map((workflow) => ({
      key: workflow.roleCode,
      ownerLabel: this.formatRole(workflow.roleCode),
      requestKinds: workflow.requestKinds,
      optionKinds: workflow.optionKinds,
    })),
  ];

  formatUnitCode(unitCode: string): string {
    return unitCode.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  formatRole(role: string): string {
    return role.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  formatKind(kind: string): string {
    return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
  }
}
