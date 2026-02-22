import { describe, it, expect } from 'vitest';
import { getRouteReliability, parseOtpStats } from '../server/otp.js';

const SAMPLE_HTML = `
<table>
  <tr bgcolor="#EFEFEF">
    <th rowspan="2" scope="col">Carriers</th>
    <th align='center' colspan='8'>Late Flights</th>
  </tr>
  <tr bgcolor="#EFEFEF">
    <th scope="col">Total Number</th>
    <th scope="col">Average Departure Delay (minutes)</th>
    <th scope="col">Average Taxi-Out Time (minutes)</th>
    <th scope="col">Average Scheduled Departure to Take-off (minutes)</th>
    <th scope="col">Average Arrival Delay (minutes)</th>
    <th scope="col">Average Airborne Time (minutes)</th>
    <th scope="col">Average Taxi-In Time (minutes)</th>
    <th scope="col">Percent Flights Late</th>
  </tr>
  <tr>
    <td>ALL*</td><td>235</td><td>62.91</td><td>25.43</td><td>57.71</td><td>75.22</td><td>108.85</td><td>10.68</td><td>30.92</td>
  </tr>
</table>
<table>
  <tr bgcolor="#EFEFEF">
    <th rowspan="2" scope="col">Carriers</th>
    <th rowspan="2" scope="col">Total Flights</th>
    <th rowspan="2" scope="col">Diverted Flights Reaching Scheduled Destination</th>
    <th align='center' colspan='2'>Average Total Ground Time (minutes)</th>
    <th align='center' colspan='5'>Cause of Delay at Destination (Average in minutes)</th>
  </tr>
  <tr bgcolor="#EFEFEF">
    <th scope="col">Diverted Flights</th>
    <th scope="col">Cancelled Flights</th>
    <th scope="col">Carrier</th>
    <th scope="col">Weather</th>
    <th scope="col">National Aviation System</th>
    <th scope="col">Security</th>
    <th scope="col">Late Aircraft Arrival</th>
  </tr>
  <tr>
    <td>ALL*</td><td>760</td><td>2</td><td>21.00</td><td>20.75</td><td>13.79</td><td>0.89</td><td>41.23</td><td>1.35</td><td>17.94</td>
  </tr>
</table>
`;

describe('BTS On-Time Performance parsing', () => {
  it('extracts delay percent and total flights', () => {
    const { delayPct, totalFlights } = parseOtpStats(SAMPLE_HTML);
    expect(delayPct).toBeCloseTo(30.92, 2);
    expect(totalFlights).toBe(760);
  });

  it('returns unavailable when OTP_DISABLE is set', async () => {
    const prev = process.env.OTP_DISABLE;
    process.env.OTP_DISABLE = 'true';
    const result = await getRouteReliability('ATL', 'LGA');
    expect(result.available).toBe(false);
    expect(result.delayPct).toBeNull();
    if (prev === undefined) delete process.env.OTP_DISABLE;
    else process.env.OTP_DISABLE = prev;
  });
});
