// A small POSIX-ish command-line parser: quotes, $VARS, ~, globs, |, ;, &&, ||, > and >>.

export interface Word {
  v: string;
  /** Contains an unquoted * or ? and should be glob-expanded. */
  glob: boolean;
}

export interface SimpleCmd {
  words: Word[];
  redirect?: { path: string; append: boolean };
}

export interface Chain {
  /** Operator joining this pipeline to the previous one. */
  op: ";" | "&&" | "||" | null;
  pipeline: SimpleCmd[];
}

type Tok = { k: "word"; w: Word } | { k: "op"; v: "|" | ";" | "&&" | "||" | ">" | ">>" };

export function tokenize(line: string, env: Record<string, string>, home: string): Tok[] | { error: string } {
  const toks: Tok[] = [];
  let i = 0;
  let cur: Word | null = null;
  let quotedAny = false;

  const flush = () => {
    if (cur) {
      if (!quotedAny && (cur.v === "~" || cur.v.startsWith("~/"))) cur.v = home + cur.v.slice(1);
      toks.push({ k: "word", w: cur });
    }
    cur = null;
    quotedAny = false;
  };
  const push = (ch: string, glob = false) => {
    if (!cur) cur = { v: "", glob: false };
    cur.v += ch;
    if (glob) cur.glob = true;
  };
  const readVar = (): string => {
    // at '$'
    let name = "";
    if (line[i + 1] === "{") {
      const end = line.indexOf("}", i + 2);
      if (end < 0) return "$";
      name = line.slice(i + 2, end);
      i = end;
    } else {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_?]/.test(line[j])) j++;
      name = line.slice(i + 1, j);
      if (!name) return "$";
      i = j - 1;
    }
    return env[name] ?? "";
  };

  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return { error: "unexpected EOF while looking for matching `''" };
      if (!cur) cur = { v: "", glob: false };
      cur.v += line.slice(i + 1, end);
      quotedAny = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      if (!cur) cur = { v: "", glob: false };
      quotedAny = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) {
          cur.v += line[i + 1];
          i += 2;
          continue;
        }
        if (line[i] === "$") cur.v += readVar();
        else cur.v += line[i];
        i++;
      }
      if (i >= line.length) return { error: 'unexpected EOF while looking for matching `"\'' };
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      push(line[i + 1]);
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flush();
      i++;
      continue;
    }
    if (ch === "#" && !cur) break;
    if (ch === "$") {
      const val = readVar();
      if (!cur) cur = { v: "", glob: false };
      cur.v += val;
      i++;
      continue;
    }
    if (ch === "|" || ch === ";" || ch === "&" || ch === ">") {
      flush();
      const two = line.slice(i, i + 2);
      if (two === "||" || two === "&&" || two === ">>") {
        toks.push({ k: "op", v: two });
        i += 2;
      } else if (ch === "&") {
        // Background jobs aren't a thing here; treat a lone & as a separator.
        toks.push({ k: "op", v: ";" });
        i++;
      } else {
        toks.push({ k: "op", v: ch as "|" | ";" | ">" });
        i++;
      }
      continue;
    }
    push(ch, ch === "*" || ch === "?");
    i++;
  }
  flush();
  return toks;
}

export function parse(line: string, env: Record<string, string>, home: string): Chain[] | { error: string } {
  const toks = tokenize(line, env, home);
  if (!Array.isArray(toks)) return toks;
  const chains: Chain[] = [];
  let op: Chain["op"] = null;
  let pipeline: SimpleCmd[] = [];
  let cmd: SimpleCmd = { words: [] };

  const endCmd = (): string | null => {
    if (!cmd.words.length) return "syntax error near unexpected token";
    pipeline.push(cmd);
    cmd = { words: [] };
    return null;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "word") {
      cmd.words.push(t.w);
      continue;
    }
    if (t.v === ">" || t.v === ">>") {
      const target = toks[i + 1];
      if (!target || target.k !== "word") return { error: "syntax error near unexpected token `newline'" };
      cmd.redirect = { path: target.w.v, append: t.v === ">>" };
      i++;
      continue;
    }
    const e = endCmd();
    if (e) return { error: `${e} \`${t.v}'` };
    if (t.v === "|") continue;
    chains.push({ op, pipeline });
    pipeline = [];
    op = t.v as Chain["op"];
  }
  if (cmd.words.length) pipeline.push(cmd);
  else if (pipeline.length) return { error: "syntax error: unexpected end of file" }; // trailing |
  if (pipeline.length) chains.push({ op, pipeline });
  return chains;
}
