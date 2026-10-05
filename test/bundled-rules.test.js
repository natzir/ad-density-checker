import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAdRule } from '../lib/adlist.js';
import { bundledRules, listsFor, pageLanguage } from '../lib/bundled-rules.js';

const on = (pageHost) => ({ type: 'script', pageHost });
const ONESIGNAL = 'https://cdn.onesignal.com/sdks/OneSignalSDK.js';
const SUNMEDIA = 'https://static.sunmedia.tv/integrations/8e63b0ec/8e63b0ec.js';

test('the page language: the lang attribute\'s primary subtag, else the host\'s country', () => {
  assert.equal(pageLanguage('es-ES', 'x.com'), 'es');
  assert.equal(pageLanguage('pt_BR', 'x.com'), 'pt');
  assert.equal(pageLanguage('EN-gb', 'x.com'), 'en');
  assert.equal(pageLanguage('', 'www.farodevigo.es'), 'es');
  assert.equal(pageLanguage('', 'www.clarin.com.ar'), 'es');
  assert.equal(pageLanguage('', 'example.com'), '');
});

test('EasyList always, plus the lists of the page\'s language', () => {
  assert.deepEqual(listsFor('es', ''), ['EasyList', 'EasyList Spanish']);
  assert.deepEqual(listsFor('en', ''), ['EasyList']);
  assert.deepEqual(listsFor('', 'www.elpais.es'), ['EasyList', 'EasyList Spanish']);
  assert.deepEqual(listsFor('ru-RU', ''), ['EasyList', 'RU AdList']);
});

test('a Spanish page does not get other languages\' rules; a Romanian one does', () => {
  assert.equal(matchAdRule(bundledRules('es', ''), ONESIGNAL, on('www.farodevigo.es')), null);
  assert.ok(matchAdRule(bundledRules('ro', ''), ONESIGNAL, on('example.ro')));
});

test('the Spanish set still covers SunMedia, names the list, and is compiled once', () => {
  const rules = bundledRules('es', '');
  const rule = matchAdRule(rules, SUNMEDIA, on('www.farodevigo.es'));
  assert.match(rule ?? '', /sunmedia\.tv/);
  assert.ok(['EasyList', 'EasyList Spanish'].includes(rules.listOf.get(rule)));
  assert.equal(bundledRules('es-ES', ''), rules);
  assert.notEqual(bundledRules('en', ''), rules);
});

test('only the most recently used set stays compiled', () => {
  const es = bundledRules('es', '');
  assert.equal(bundledRules('es', ''), es);
  bundledRules('fr', '');
  assert.notEqual(bundledRules('es', ''), es);
});

test('a language that says nothing (und, zxx, mul, mis) falls back to the host, and a trailing dot is ignored', () => {
  for (const lang of ['und', 'zxx', 'mul', 'mis', 'UND']) assert.equal(pageLanguage(lang, 'www.elpais.es'), 'es');
  assert.equal(pageLanguage('und', 'example.com'), '');
  assert.equal(pageLanguage('', 'elpais.es.'), 'es');
  assert.equal(pageLanguage(undefined, 'x.es'), 'es');
  assert.equal(pageLanguage('', 'news.bbc.co.uk'), '');
});

test('a rule in EasyList and in EasyList Spanish is named after the first list', () => {
  assert.equal(bundledRules('es', '').listOf.get('||palibzh.tech^'), 'EasyList');
});
