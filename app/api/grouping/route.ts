import { isAdminRequest } from "../../../lib/auth";
import { getRoundHistory, historyRows, saveRound } from "../../../lib/database";
import { loadFeishuData, updateSelectionRecords } from "../../../lib/feishu";
import { historyFromRows, makeGrouping, patchesForEvaluations, validateSelections } from "../../../lib/grouping";

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    const body = await request.json() as { round?: string; apply?: boolean };
    const round = body.round?.trim() ?? "";
    if (!round || round.length > 40) return Response.json({ ok: false, error: "请输入有效期次" }, { status: 400 });
    const [{ members, selections }, storedHistory] = await Promise.all([loadFeishuData(), historyRows(round)]);
    const validation = validateSelections(members, selections, round);
    const history = historyFromRows(storedHistory);
    const grouping = makeGrouping(validation.effective, history, round);
    const patches = patchesForEvaluations(validation.evaluations, grouping.assignments);
    const invalid = validation.evaluations.filter((item) => item.error).map((item) => ({ name: item.name || "未填写", reason: item.error }));
    const stats = {
      active: validation.activeMembers.length,
      submitted: validation.effective.length,
      missing: validation.missing.length,
      groups: grouping.exportRows.length,
      pending: grouping.exportRows.filter((row) => row.group === "待协调").length,
      invalid: invalid.length,
    };
    if (body.apply === true) {
      await updateSelectionRecords(patches);
      await saveRound({ round, stats, effective: validation.effective, groups: grouping.exportRows });
    }
    return Response.json({
      ok: true,
      data: {
        round,
        applied: body.apply === true,
        historyRound: history.lastRound || null,
        stats,
        missing: validation.missing.map((member) => member.name),
        invalid,
        groups: grouping.exportRows.map(({ memberKeys: _memberKeys, ...group }) => group),
        history: body.apply === true ? await getRoundHistory() : undefined,
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "运行失败" }, { status: 500 });
  }
}
