'use strict';

const AdmZip = require('adm-zip');
const { detectAll } = require('./detectors');

const TEXT_NODE_RE = /<w:(t|instrText)((?:\s+[^>]*)?)>([\s\S]*?)<\/w:\1>/g;


function getTextPartNames(zip) {
  return zip
    .getEntries()
    .map((e) => e.entryName)
    .filter(
      (name) =>
        name === 'word/document.xml' ||
        /^word\/(header|footer)\d*\.xml$/.test(name)
    );
}

function xmlDecode(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlEncode(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


function extractTextNodes(xml) {
  const nodes = [];
  let plainText = '';
  let match;
  const re = new RegExp(TEXT_NODE_RE.source, 'g');
  while ((match = re.exec(xml)) !== null) {
    const [full, tagName, attrs, rawInner] = match;
    const decoded = xmlDecode(rawInner);
    nodes.push({
      rawStart: match.index,
      rawEnd: match.index + full.length,
      tagName,
      attrs,
      originalText: decoded,
      plainStart: plainText.length,
      plainEnd: plainText.length + decoded.length,
    });
    plainText += decoded;
  }
  return { nodes, plainText };
}


function applyMatchesToText(text, matches, fakeMap, log) {
  let result = '';
  let cursor = 0;
  for (const m of matches) {
    if (m.index < cursor) continue; 
    result += text.slice(cursor, m.index);
    const fake = fakeMap.getFake(m.type, m.value);
    result += fake;
    if (log) log.push({ type: m.type, original: m.value, replacement: fake });
    cursor = m.index + m.length;
  }
  result += text.slice(cursor);
  return result;
}

function redactXmlPart(xml, fakeMap, log) {
  const { nodes, plainText } = extractTextNodes(xml);
  const allMatches = detectAll(plainText);

 
  let skippedCrossRunMatches = 0;
  const nodeMatches = nodes.map(() => []);

  let nodeIdx = 0;
  for (const m of allMatches) {
    while (nodeIdx < nodes.length - 1 && nodes[nodeIdx].plainEnd <= m.index) {
      nodeIdx++;
    }
    const node = nodes[nodeIdx];
    if (!node) continue;
    const matchEndsInNode = m.index >= node.plainStart && m.index + m.length <= node.plainEnd;
    if (!matchEndsInNode) {
      skippedCrossRunMatches++;
      continue;
    }
    nodeMatches[nodeIdx].push({
      type: m.type,
      value: m.value,
      index: m.index - node.plainStart,
      length: m.length,
    });
  }

  let newXml = '';
  let prevRawEnd = 0;
  nodes.forEach((node, i) => {
    const matches = nodeMatches[i];
    newXml += xml.slice(prevRawEnd, node.rawStart);
    if (matches.length === 0) {
      newXml += xml.slice(node.rawStart, node.rawEnd);
    } else {
      const redactedText = applyMatchesToText(node.originalText, matches, fakeMap, log);
      newXml += `<w:${node.tagName}${node.attrs}>${xmlEncode(redactedText)}</w:${node.tagName}>`;
    }
    prevRawEnd = node.rawEnd;
  });
  newXml += xml.slice(prevRawEnd);

  return { newXml, skippedCrossRunMatches };
}

function redactDocx(inputPath, outputPath, fakeMap) {
  const zip = new AdmZip(inputPath);
  const partNames = getTextPartNames(zip);
  if (partNames.length === 0) {
    throw new Error(`No word/document.xml or header/footer parts found in ${inputPath} — is this a valid .docx?`);
  }

  const log = [];
  let skippedCrossRunMatches = 0;

  for (const partName of partNames) {
    const entry = zip.getEntry(partName);
    const xml = zip.readAsText(entry, 'utf8');
    const { newXml, skippedCrossRunMatches: skipped } = redactXmlPart(xml, fakeMap, log);
    skippedCrossRunMatches += skipped;
    zip.updateFile(entry, Buffer.from(newXml, 'utf8'));
  }

  zip.writeZip(outputPath);

  return { log, matchCount: log.length, skippedCrossRunMatches, partsProcessed: partNames.length };
}

module.exports = { redactDocx, extractTextNodes, xmlDecode, xmlEncode };