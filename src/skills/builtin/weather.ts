/**
 * Built-in /weather skill — get weather for a city.
 * Uses free wttr.in API (no key needed).
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';

export function createWeatherSkill(): Skill {
  return {
    name: 'weather',
    description: 'Get weather. Usage: /weather <city>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const city = request.text?.trim() || 'Beijing';
      try {
        const res = await fetch(
          `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as any;

        const current = data.current_condition?.[0];
        if (!current) return { text: `⚠️ 未找到 ${city} 的天气数据` };

        const desc = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '';
        const temp = current.temp_C;
        const feelsLike = current.FeelsLikeC;
        const humidity = current.humidity;
        const wind = current.windspeedKmph;
        const area = data.nearest_area?.[0];
        const location = area ? `${area.areaName?.[0]?.value}, ${area.country?.[0]?.value}` : city;

        // Forecast
        const forecast = (data.weather || []).slice(0, 3).map((d: any) => {
          const desc = d.hourly?.[4]?.lang_zh?.[0]?.value || d.hourly?.[4]?.weatherDesc?.[0]?.value || '';
          return `  ${d.date}: ${d.mintempC}~${d.maxtempC}°C ${desc}`;
        });

        return {
          text: [
            `🌤️ ${location}`,
            `━━━━━━━━━━`,
            `🌡️ ${temp}°C (体感 ${feelsLike}°C)`,
            `☁️ ${desc}`,
            `💧 湿度 ${humidity}%`,
            `💨 风速 ${wind}km/h`,
            forecast.length ? `\n📅 三日预报:\n${forecast.join('\n')}` : '',
          ].filter(Boolean).join('\n'),
        };
      } catch (err) {
        return { text: `⚠️ 天气查询失败: ${(err as Error).message}` };
      }
    },
  };
}
