"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { grades } from "@/features/requests/schema";
import type { Grade, Student } from "@/features/requests/service";

const gradeLabels: Record<Grade, string> = {
  GRADE_1: "一年级", GRADE_2: "二年级", GRADE_3: "三年级", GRADE_4: "四年级", GRADE_5: "五年级", GRADE_6: "六年级",
  GRADE_7: "初一", GRADE_8: "初二", GRADE_9: "初三", GRADE_10: "高一", GRADE_11: "高二", GRADE_12: "高三", OTHER: "其他阶段",
};

export function StudentManager({ initialStudents }: { initialStudents: Student[] }) {
  const [students, setStudents] = useState(initialStudents);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publicAlias, setPublicAlias] = useState("");
  const [grade, setGrade] = useState<Grade>("GRADE_7");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function reset() { setEditingId(null); setPublicAlias(""); setGrade("GRADE_7"); setNotes(""); }
  function edit(student: Student) { setEditingId(student.id); setPublicAlias(student.publicAlias); setGrade(student.grade); setNotes(student.notes ?? ""); setMessage(null); }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(null);
    try {
      const response = await fetch(editingId ? `/api/parent/students/${editingId}` : "/api/parent/students", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicAlias, grade, notes: notes || null }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      setStudents(editingId ? students.map((item) => item.id === editingId ? body.student : item) : [body.student, ...students]);
      reset(); setMessage("学生档案已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (busy || !window.confirm("删除后不会影响历史需求，但该学生不能用于新需求。确认删除？")) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/parent/students/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除失败");
      setStudents(students.filter((student) => student.id !== id));
      if (editingId === id) reset();
      setMessage("学生档案已删除");
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="student-workspace">
      <form className="student-form" onSubmit={submit} aria-busy={busy}>
        <div><p className="eyebrow">{editingId ? "编辑学习档案" : "新增学习档案"}</p><h2>只使用公开学习昵称</h2><p>不要填写真实姓名、手机号、学校全称或精确地址。</p></div>
        <FormField htmlFor="student-alias" label="学习昵称" required hint="例如“小树”“七七”，将在需求卡片公开显示。"><input maxLength={30} minLength={2} value={publicAlias} onChange={(event) => setPublicAlias(event.target.value)} /></FormField>
        <FormField htmlFor="student-grade" label="年级" required><select value={grade} onChange={(event) => setGrade(event.target.value as Grade)}>{grades.map((item) => <option key={item} value={item}>{gradeLabels[item]}</option>)}</select></FormField>
        <FormField htmlFor="student-notes" label="家庭内部备注（不会公开）"><textarea maxLength={500} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></FormField>
        <div className="student-form__actions"><Button disabled={busy} type="submit">{busy ? "保存中…" : editingId ? "保存修改" : "添加学生"}</Button>{editingId ? <Button disabled={busy} onClick={reset} variant="quiet">取消</Button> : null}</div>
        {message ? <p role="status">{message}</p> : null}
      </form>
      <section className="student-list" aria-label="学生档案列表">
        {students.length === 0 ? <div className="parent-empty"><span aria-hidden="true">学</span><h2>还没有学生档案</h2><p>先创建一个安全的学习昵称，再发布家教需求。</p></div> : students.map((student) => <article key={student.id} className="student-card"><div><p className="eyebrow">{gradeLabels[student.grade]}</p><h2>{student.publicAlias}</h2><p>{student.notes || "暂无家庭内部备注"}</p></div><div><Button disabled={busy} onClick={() => edit(student)} size="small" variant="outline">编辑</Button><Button disabled={busy} onClick={() => void remove(student.id)} size="small" variant="quiet">删除</Button></div></article>)}
      </section>
    </div>
  );
}
