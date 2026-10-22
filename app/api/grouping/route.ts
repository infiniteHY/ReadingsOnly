import { isAdminRequest } from "../../../lib/auth";
import { currentRoundGroups, getRoundHistory, historyRows, saveRound } from "../../../lib/database";
import { loadFeishuData, updateSelectionRecords } from "../../../lib/feishu";
import { applyGroupingEdits, historyFromRows, makeGrouping, patchesForEvaluations, reconcileSavedGrouping, validateSelections, type GroupEdit } from "../../../lib/grouping";
import { tripleWarnings } from "../../../lib/triple-allocation.mjs";

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    const body = await request.json() as { round?: string; apply?: boolean; writeFeishu?: boolean; regenerate?: boolean; groups?: GroupEdit[] };
    const round = body.round?.trim() ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(round)) return Response.json({ ok: false, error: "期次格式应为 YYYY-MM，例如 2026-08" }, { status: 400 });
    const [{ members, selections, selectionTableId }, storedHistory, savedGroups] = await Promise.all([
      loadFeishuData(round), historyRows(round), currentRoundGroups(round),
    ]);
    const validation = validateSelections(members, selections, round);
    const history = historyFromRows(storedHistory);
    const generatedGrouping = makeGrouping(validation.effective, history, round);
    const previewGrouping = body.regenerate === true ? generatedGrouping : reconcileSavedGrouping(generatedGrouping, savedGroups);
    const grouping = body.apply === true && body.groups
      ? applyGroupingEdits(validation.effective, generatedGrouping, body.groups)
      : applyGroupingEdits(validation.effective, generatedGrouping, previewGrouping.exportRows);
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
    const writeFeishu = body.apply === true && body.writeFeishu !== false;
    if (body.apply === true) {
      if (writeFeishu && grouping.exportRows.some((row) => row.group === "待协调")) {
        return Response.json({ ok: false, error: "仍有待分组成员，请先拖动完成分组或设为读书笔记组" }, { status: 400 });
      }
      await saveRound({ round, stats, effective: validation.effective, groups: grouping.exportRows });
      if (writeFeishu) {
        try {
          await updateSelectionRecords(selectionTableId, patches);
        } catch (error) {
          return Response.json({ ok: false, stored: true, error: `分组已保存到平台数据库，但飞书写回未完成，请重试：${error instanceof Error ? error.message : "写回失败"}` }, { status: 502 });
        }
      }
    }
    let refreshedHistory: Awaited<ReturnType<typeof getRoundHistory>> | undefined;
    let historyWarning: string | undefined;
    if (body.apply === true) {
      try {
        refreshedHistory = await getRoundHistory();
      } catch {
        historyWarning = "分组已保存，但历史列表刷新失败，可稍后刷新页面查看。";
      }
    }
    return Response.json({
      ok: true,
      data: {
        round,
        selectionTableId,
        applied: writeFeishu,
        stored: body.apply === true,
        historyRound: history.lastRound || null,
        stats,
        missing: validation.missing.map((member) => member.name),
        invalid,
        groups: grouping.exportRows.map((group) => ({ book: group.book, group: group.group, members: group.members, memberKeys: group.memberKeys })),
        warnings: tripleWarnings(grouping.exportRows),
        history: refreshedHistory,
        historyWarning,
      },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "运行失败" }, { status: 500 });
  }
}
