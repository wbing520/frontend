import { mdiChevronRight } from "@mdi/js";
import "@material/mwc-list/mwc-list-item";
import "@material/mwc-button/mwc-button";
import {
  LitElement,
  TemplateResult,
  html,
  CSSResultGroup,
  css,
  PropertyValues,
} from "lit";
import { customElement, property, state } from "lit/decorators";
import memoizeOne from "memoize-one";
import { fireEvent } from "../../../common/dom/fire_event";
import { haStyle, haStyleDialog } from "../../../resources/styles";
import { HomeAssistant } from "../../../types";
import "../../../components/ha-dialog";
import "../../../components/ha-svg-icon";
import "../../../components/ha-circular-progress";
import "../../../components/ha-selector/ha-selector-datetime";
import "../../../components/ha-selector/ha-selector-number";
import "../../../components/ha-form/ha-form";
import type { DialogStatisticsAdjustSumParams } from "./show-dialog-statistics-adjust-sum";
import {
  adjustStatisticsSum,
  fetchStatistics,
  StatisticValue,
} from "../../../data/history";
import { showAlertDialog } from "../../../dialogs/generic/show-dialog-box";
import { showToast } from "../../../util/toast";
import type { DateTimeSelector, NumberSelector } from "../../../data/selector";
import { formatDateTime } from "../../../common/datetime/format_date_time";

/* eslint-disable lit/no-template-arrow */

@customElement("dialog-statistics-adjust-sum")
export class DialogStatisticsFixUnsupportedUnitMetadata extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _params?: DialogStatisticsAdjustSumParams;

  @state() private _busy = false;

  @state() private _moment?: string;

  @state() private _stats5min?: StatisticValue[];

  @state() private _statsHour?: StatisticValue[];

  @state() private _chosenStat?: StatisticValue;

  private _origAmount?: number;

  @state() private _amount?: number;

  private _dateTimeSelector: DateTimeSelector = {
    datetime: {},
  };

  private _amountSelector = memoizeOne(
    (unit_of_measurement: string): NumberSelector => ({
      number: {
        step: 0.01,
        unit_of_measurement,
        mode: "box",
      },
    })
  );

  public showDialog(params: DialogStatisticsAdjustSumParams): void {
    this._params = params;
    const now = new Date();
    this._moment = `${now.getFullYear()}-${
      now.getMonth() + 1
    }-${now.getDate()} ${now.getHours()}:${
      now.getMinutes() - (now.getMinutes() % 5)
    }:00`;
    this._fetchStats();
  }

  public closeDialog(): void {
    this._params = undefined;
    this._moment = undefined;
    this._stats5min = undefined;
    this._statsHour = undefined;
    this._origAmount = undefined;
    this._amount = undefined;
    this._chosenStat = undefined;
    this._busy = false;
    fireEvent(this, "dialog-closed", { dialog: this.localName });
  }

  protected render(): TemplateResult | void {
    if (!this._params) {
      return html``;
    }

    let content: TemplateResult;

    if (!this._chosenStat) {
      content = this._renderPickStatistic();
    } else {
      content = this._renderAdjustStat();
    }

    return html`
      <ha-dialog
        open
        scrimClickAction
        escapeKeyAction
        @closed=${this.closeDialog}
        heading="Adjust a statistic"
      >
        ${content}
      </ha-dialog>
    `;
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.size !== 1 || !changedProps.has("hass")) {
      return true;
    }
    // We only respond to hass changes if the translations changed
    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
    return !oldHass || oldHass.localize !== this.hass.localize;
  }

  private _renderPickStatistic() {
    let stats: TemplateResult;

    if (!this._stats5min || !this._statsHour) {
      stats = html` <ha-circular-progress active></ha-circular-progress> `;
    } else if (this._statsHour.length < 2 && this._stats5min.length < 2) {
      stats = html` <p>No statistics found for this period.</p> `;
    } else {
      const data =
        this._stats5min.length >= 2 ? this._stats5min : this._statsHour;
      const unit = this._params!.statistic.unit_of_measurement;
      const rows: TemplateResult[] = [];
      for (let i = 1; i < data.length; i++) {
        const stat = data[i];
        const growth = Math.round((stat.sum! - data[i - 1].sum!) * 100) / 100;
        rows.push(html`
          <mwc-list-item
            twoline
            hasMeta
            @click=${() => {
              this._chosenStat = stat;
              this._origAmount = growth;
              this._amount = growth;
            }}
          >
            <span>${growth} ${unit}</span>
            <span slot="secondary">
              ${formatDateTime(new Date(stat.start), this.hass.locale)}
            </span>
            <ha-svg-icon slot="meta" .path=${mdiChevronRight}></ha-svg-icon>
          </mwc-list-item>
        `);
      }
      stats = html`${rows}`;
    }

    return html`
      <div class="text-content">
        Sometimes the statistics end up being incorrect for a specific point in
        time. This can mess up your beautiful graphs! Select a time below to
        find the bad moment and adjust the data.
      </div>
      <ha-selector-datetime
        label="Pick a time"
        .hass=${this.hass}
        .selector=${this._dateTimeSelector}
        .value=${this._moment}
        @value-changed=${(ev) => {
          this._moment = ev.detail.value;
          this._fetchStats();
        }}
      ></ha-selector-datetime>

      <div class="stat-list">${stats}</div>

      <mwc-button
        slot="primaryAction"
        dialogAction="cancel"
        .label=${this.hass.localize("ui.common.close")}
      ></mwc-button>
    `;
  }

  private _renderAdjustStat() {
    return html`
      <div class="text-content">
        ${this._params!.statistic.name || this._params!.statistic.statistic_id}
      </div>

      <div class="table-row">
        <span>Start</span>
        <span
          >${formatDateTime(
            new Date(this._chosenStat!.start),
            this.hass.locale
          )}</span
        >
      </div>

      <div class="table-row">
        <span>End</span>
        <span
          >${formatDateTime(
            new Date(this._chosenStat!.end),
            this.hass.locale
          )}</span
        >
      </div>

      <ha-selector-number
        label="New Value"
        .hass=${this.hass}
        .selector=${this._amountSelector(
          this._params!.statistic.unit_of_measurement
        )}
        .value=${this._amount}
        .disabled=${this._busy}
        @value-changed=${(ev) => {
          this._amount = ev.detail.value;
        }}
      ></ha-selector-number>

      <mwc-button
        slot="primaryAction"
        label="Adjust"
        .disabled=${this._busy}
        @click=${() => {
          this._fixIssue();
        }}
      ></mwc-button>
      <mwc-button
        slot="secondaryAction"
        .label=${this.hass.localize("ui.common.back")}
        .disabled=${this._busy}
        @click=${() => {
          this._chosenStat = undefined;
        }}
      ></mwc-button>
    `;
  }

  private async _fetchStats(): Promise<void> {
    this._stats5min = undefined;
    this._statsHour = undefined;
    const statId = this._params!.statistic.statistic_id;
    const moment = new Date(this._moment!);

    // Search 3 hours before and 3 hours after chosen time
    const hourStatStart = new Date(moment.getTime());
    hourStatStart.setTime(hourStatStart.getTime() - 3 * 3600 * 1000);
    const hourStatEnd = new Date(moment.getTime());
    hourStatEnd.setTime(hourStatEnd.getTime() + 3 * 3600 * 1000);

    const statsHourData = await fetchStatistics(
      this.hass,
      hourStatStart,
      hourStatEnd,
      [statId],
      "hour"
    );
    this._statsHour =
      statId in statsHourData ? statsHourData[statId].slice(0, 6) : [];

    // Can't have 5 min data if no hourly data
    if (this._statsHour.length === 0) {
      this._stats5min = [];
      return;
    }

    // Search 15 minutes before and 15 minutes after chosen time
    const minStatStart = new Date(moment.getTime());
    minStatStart.setTime(minStatStart.getTime() - 15 * 60 * 1000);
    const minStatEnd = new Date(moment.getTime());
    minStatEnd.setTime(minStatEnd.getTime() + 15 * 60 * 1000);

    const stats5MinData = await fetchStatistics(
      this.hass,
      minStatStart,
      minStatEnd,
      [statId],
      "5minute"
    );

    this._stats5min =
      statId in stats5MinData ? stats5MinData[statId].slice(0, 6) : [];
  }

  private async _fixIssue(): Promise<void> {
    this._busy = true;
    try {
      await adjustStatisticsSum(
        this.hass,
        this._params!.statistic.statistic_id,
        this._chosenStat!.start,
        this._amount! - this._origAmount!
      );
    } catch (err: any) {
      this._busy = false;
      showAlertDialog(this, {
        text: `Error adjusting sum: ${err.message || err}`,
      });
      return;
    }
    showToast(this, {
      message: "Statistic sum adjusted",
    });
    this.closeDialog();
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      haStyleDialog,
      css`
        .text-content,
        ha-selector-datetime,
        ha-selector-number {
          margin-bottom: 20px;
        }
        mwc-list-item {
          margin: 0 -24px;
          --mdc-list-side-padding: 24px;
        }
        .table-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .stat-list {
          min-height: 360px;
          display: flex;
          flex-direction: column;
        }
        .stat-list ha-circular-progress {
          margin: 0 auto;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dialog-statistics-adjust-sum": DialogStatisticsFixUnsupportedUnitMetadata;
  }
}
