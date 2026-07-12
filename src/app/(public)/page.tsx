import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const teacherPreviews = [
  {
    initials: "林",
    name: "林老师",
    subject: "初中数学 · 5 年经验",
    area: "海淀 · 双榆树",
    detail: "善于把几何题拆成可复用的思考步骤",
  },
  {
    initials: "周",
    name: "周老师",
    subject: "小学英语 · 师范在读",
    area: "朝阳 · 望京",
    detail: "自然拼读与绘本阅读，注重表达信心",
  },
];

const requestPreviews = [
  {
    grade: "初二",
    subject: "数学巩固",
    area: "杨浦 · 五角场",
    schedule: "周六下午 · 每周 1 次",
  },
  {
    grade: "高一",
    subject: "物理入门",
    area: "浦东 · 花木",
    schedule: "工作日晚间 · 时间可商量",
  },
];

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="hero section-pad" aria-labelledby="hero-title">
        <div className="site-container hero__grid">
          <div className="hero__copy">
            <Badge tone="paper">邻里互助式家教信息平台</Badge>
            <h1 id="hero-title">找到合适的老师，也找到真正需要你的学生</h1>
            <p className="hero__lead">
              不让信息费隔开一次真诚的相遇。按地区、学段与时间直接发布，
              在熟悉的生活圈里，把合适的人连接起来。
            </p>
            <div className="hero__actions" aria-label="选择使用身份">
              <Link className="button button--primary" href="/parent">
                我是家长
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="button button--outline" href="/teacher">
                我是老师
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className="hero__assurance">
              <span aria-hidden="true">✓</span>
              发布与联系均不收信息费
            </p>
          </div>

          <div className="noticeboard" aria-label="地区圈子示意">
            <div className="noticeboard__pin noticeboard__pin--one" aria-hidden="true" />
            <div className="noticeboard__pin noticeboard__pin--two" aria-hidden="true" />
            <p className="noticeboard__ribbon">
              <span>地区圈子</span>
              海淀 · 双榆树
            </p>
            <article className="paper-note paper-note--teacher">
              <Badge tone="red">演示内容</Badge>
              <p className="paper-note__label">附近老师</p>
              <strong>初中数学 · 林老师</strong>
              <span>步行约 12 分钟</span>
            </article>
            <article className="paper-note paper-note--request">
              <Badge tone="red">演示内容</Badge>
              <p className="paper-note__label">最新需求</p>
              <strong>初二几何巩固</strong>
              <span>周六下午 · 每周一次</span>
            </article>
            <p className="noticeboard__caption">
              同一个地区圈子，让通勤、时间与信任都更可控。
            </p>
          </div>
        </div>
      </section>

      <section className="role-section section-pad" aria-labelledby="role-title">
        <div className="site-container">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">从你的身份开始</p>
              <h2 id="role-title">两种入口，同一种坦诚</h2>
            </div>
            <p>信息写清楚，彼此少绕路。平台只做连接，不做层层转手的中介。</p>
          </div>
          <div className="role-grid">
            <Card className="role-card role-card--parent" tactile>
              <span className="role-card__number" aria-hidden="true">01</span>
              <p className="eyebrow">给家庭</p>
              <h3>把真实需求说清楚</h3>
              <p>填写地区、年级、科目和可上课时间，让合适的老师主动看见你。</p>
              <ul className="plain-list">
                <li>按地区查看附近老师</li>
                <li>直接比较经历与授课方向</li>
                <li>自主沟通，不收信息费</li>
              </ul>
              <Link className="text-link" href="/parent">发布家教需求 <span aria-hidden="true">→</span></Link>
            </Card>
            <Card className="role-card role-card--teacher" tactile>
              <span className="role-card__number" aria-hidden="true">02</span>
              <p className="eyebrow">给老师</p>
              <h3>让专业被附近家庭看见</h3>
              <p>完整展示学科、经验与可授课地区，寻找时间真正匹配的学生。</p>
              <ul className="plain-list">
                <li>建立清晰的老师资料</li>
                <li>筛选附近的真实需求</li>
                <li>双方确认后再交换联系</li>
              </ul>
              <Link className="text-link" href="/teacher">创建老师资料 <span aria-hidden="true">→</span></Link>
            </Card>
          </div>
        </div>
      </section>

      <section className="neighborhood section-pad" id="neighborhood" aria-labelledby="neighborhood-title">
        <div className="site-container neighborhood__grid">
          <div className="neighborhood__intro">
            <p className="eyebrow">地区圈子</p>
            <h2 id="neighborhood-title">先看生活半径，再谈合不合适</h2>
            <p>
              家教是长期相处。地区圈子把同一街道、商圈或社区周边的老师与家庭聚在一起，
              先降低通勤的不确定，再认真了解教学方式。
            </p>
          </div>
          <div className="circle-map" aria-hidden="true">
            <span className="circle-map__center">你所在的地区</span>
            <span className="circle-map__node circle-map__node--one">老师</span>
            <span className="circle-map__node circle-map__node--two">家庭</span>
            <span className="circle-map__node circle-map__node--three">需求</span>
          </div>
          <ol className="neighborhood__steps">
            <li><span>一</span><div><strong>选择地区</strong><p>从城市逐步定位到常住片区。</p></div></li>
            <li><span>二</span><div><strong>浏览圈内信息</strong><p>老师与需求按清晰条件呈现。</p></div></li>
            <li><span>三</span><div><strong>双方自主沟通</strong><p>确认匹配后，再推进下一步。</p></div></li>
          </ol>
        </div>
      </section>

      <section className="promise section-pad" aria-labelledby="promise-title">
        <div className="site-container promise__inner">
          <p className="promise__stamp" aria-hidden="true">0</p>
          <div>
            <p className="eyebrow">零信息费承诺</p>
            <h2 id="promise-title">连接，不该成为一笔隐形成本</h2>
          </div>
          <p>
            浏览、发布、表达联系意向，平台均不收取信息费。我们会明确说明每一步，
            不用“解锁联系方式”等话术制造焦虑。
          </p>
        </div>
      </section>

      <section className="safety section-pad" id="safety" aria-labelledby="safety-title">
        <div className="site-container">
          <div className="section-heading">
            <p className="eyebrow">安全步骤</p>
            <h2 id="safety-title">每次联系之前，多三步安心</h2>
            <p>资料越透明，沟通越具体，线下见面越从容。</p>
          </div>
          <ol className="safety-grid">
            <li><span>01</span><h3>资料先核对</h3><p>查看身份、经历与地区信息是否完整，发现异常可暂停沟通。</p></li>
            <li><span>02</span><h3>需求说具体</h3><p>在站内先确认科目、时间、地点与预期，避免信息不对称。</p></li>
            <li><span>03</span><h3>见面留余地</h3><p>首次见面选择公共场所，未成年人由监护人陪同并保留沟通记录。</p></li>
          </ol>
        </div>
      </section>

      <section className="preview section-pad" aria-labelledby="preview-title">
        <div className="site-container">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">看看信息会怎样呈现</p>
              <h2 id="preview-title">真实上线前，先用示例认识平台</h2>
            </div>
            <p>以下老师与需求均为界面演示，不代表真实用户或可联系信息。</p>
          </div>
          <div className="preview-grid">
            <section className="preview-column" aria-labelledby="teachers-preview-title">
              <div className="preview-column__title">
                <h3 id="teachers-preview-title">老师预览</h3>
                <span>附近</span>
              </div>
              {teacherPreviews.map((teacher) => (
                <article className="profile-preview" key={teacher.name}>
                  <div className="profile-preview__avatar" aria-hidden="true">{teacher.initials}</div>
                  <div className="profile-preview__body">
                    <div><strong>{teacher.name}</strong><Badge tone="red">演示内容</Badge></div>
                    <p>{teacher.subject}</p>
                    <p className="preview-meta">{teacher.area}</p>
                    <span>{teacher.detail}</span>
                  </div>
                </article>
              ))}
              <Link className="text-link" href="/parent">从家长入口查看更多 <span aria-hidden="true">→</span></Link>
            </section>
            <section className="preview-column preview-column--requests" aria-labelledby="requests-preview-title">
              <div className="preview-column__title">
                <h3 id="requests-preview-title">需求预览</h3>
                <span>新发布</span>
              </div>
              {requestPreviews.map((request) => (
                <article className="request-preview" key={`${request.grade}-${request.subject}`}>
                  <div className="request-preview__top">
                    <p><strong>{request.grade}</strong> · {request.subject}</p>
                    <Badge tone="red">演示内容</Badge>
                  </div>
                  <p className="preview-meta">{request.area}</p>
                  <span>{request.schedule}</span>
                </article>
              ))}
              <Link className="text-link" href="/teacher">从老师入口查看更多 <span aria-hidden="true">→</span></Link>
            </section>
          </div>
        </div>
      </section>

      <section className="closing-cta section-pad" aria-labelledby="closing-title">
        <div className="site-container closing-cta__inner">
          <div>
            <p className="eyebrow">就在你的地区圈子里</p>
            <h2 id="closing-title">把需求写清楚，把选择留给彼此</h2>
          </div>
          <div className="closing-cta__actions">
            <Link className="button button--light" href="/parent">我是家长</Link>
            <Link className="button button--ink" href="/teacher">我是老师</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
