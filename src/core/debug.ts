// URL-driven debug options, e.g.
//   ?stage=internet            jump straight to a stage (with plausible state)
//   ?stage=platformer&level=5  platformer at level 5
//   ?coins=123456              override the coin total
//   ?reset                     wipe the save
//   ?fast                      stages may speed things up for testing

const params = new URLSearchParams(location.search);

export const debug = {
  params,
  stage: params.get("stage"),
  reset: params.has("reset"),
  fast: params.has("fast"),
  num(key: string, fallback: number): number {
    const v = params.get(key);
    return v === null || v === "" || isNaN(Number(v)) ? fallback : Number(v);
  },
  str(key: string): string | null {
    return params.get(key);
  },
};
