import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function makeClient(baseURL: string, referer: string, extra?: Record<string, string>): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': referer,
      'Origin': new URL(referer).origin,
      'X-Requested-With': 'XMLHttpRequest',
      ...extra,
    },
  });
}

export function makeAjaxClient(baseURL: string, referer: string): AxiosInstance {
  return makeClient(baseURL, referer, {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
  });
}

export const anilistClient = axios.create({
  baseURL: 'https://graphql.anilist.co',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});
