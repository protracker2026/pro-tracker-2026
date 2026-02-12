/**
 * Procurement Tracker App
 * Vanilla JS implementation with localStorage
 */

// --- Data Models & Constants ---

const STEPS_TEMPLATE = [
    {
        id: 1,
        title: "สำรวจความต้องการ",
        defaultChecklist: [
            "ระบุรายการสินค้า/งานจ้างที่ต้องการ",
            "ระบุจำนวนและหน่วยนับ",
            "กำหนดคุณลักษณะเฉพาะ (Spec) เบื้องต้น",
            "ระบุหน่วยงานผู้ขอซื้อ/ขอจ้าง",
            "กำหนดวันที่ต้องการใช้งาน"
        ]
    },
    {
        id: 2,
        title: "จัดทำรายละเอียด/TOR",
        defaultChecklist: [
            "จัดทำร่างขอบเขตของงาน (TOR)",
            "กำหนดคุณสมบัติผู้เสนอราคา",
            "กำหนดเงื่อนไขการส่งมอบงาน",
            "กำหนดงวดงานและการจ่ายเงิน (ถ้ามี)",
            "ผู้มีอำนาจลงนามอนุมัติ TOR"
        ]
    },
    {
        id: 3,
        title: "ประมาณราคากลาง",
        defaultChecklist: [
            "สืบราคาจากท้องตลาด (อย่างน้อย 3 ราย)",
            "จัดทำตารางเปรียบเทียบราคา",
            "คำนวณราคากลางตามหลักเกณฑ์",
            "จัดทำรายงานขออนุมัติราคากลาง"
        ]
    },
    {
        id: 4,
        title: "ขออนุมัติจัดซื้อ/จัดจ้าง",
        defaultChecklist: [
            "จัดทำบันทึกข้อความขออนุมัติ",
            "แนบเอกสารรายละเอียด/TOR",
            "แนบเอกสารราคากลาง",
            "เสนอหัวหน้าเจ้าหน้าที่พัสดุ",
            "เสนอผู้มีอำนาจอนุมัติ (ตามวงเงิน)"
        ]
    },
    {
        id: 5,
        title: "ดำเนินการจัดซื้อ/จัดจ้าง",
        defaultChecklist: [
            "ประกาศเชิญชวน/ส่งหนังสือเชิญ",
            "รับซองข้อเสนอ/ใบเสนอราคา",
            "คณะกรรมการพิจารณาผล",
            "ประกาศผู้ชนะการเสนอราคา",
            "จัดทำสัญญาหรือใบสั่งซื้อ/สั่งจ้าง (PO)"
        ]
    },
    {
        id: 6,
        title: "ตรวจรับพัสดุ/งานจ้าง",
        defaultChecklist: [
            "ผู้ขาย/ผู้รับจ้างส่งมอบงาน",
            "คณะกรรมการตรวจรับตรวจสอบความถูกต้อง",
            "จัดทำใบตรวจรับพัสดุ/งานจ้าง",
            "บันทึกรับพัสดุเข้าคลัง (ถ้ามี)"
        ]
    },
    {
        id: 7,
        title: "เบิกจ่ายเงิน",
        defaultChecklist: [
            "รวบรวมเอกสารส่งมอบและตรวจรับทั้งหมด",
            "จัดทำเอกสารขอเบิกเงิน",
            "ส่งฝ่ายการเงิน/บัญชี",
            "ติดตามผลการโอนเงินให้ผู้ขาย",
            "เก็บเอกสารเข้าแฟ้มโครงการ"
        ]
    }
];

class Project {
    constructor(name, description, budget, deadline, template = STEPS_TEMPLATE) {
        this.id = Date.now().toString(); // Simple ID generation
        this.name = name;
        this.description = description;
        this.budget = parseFloat(budget) || 0;
        this.deadline = deadline || null;
        this.createdAt = new Date().toISOString();
        this.status = 'active'; // active, completed
        this.currentStepIndex = 0; // 0-based index (0 = Step 1)

        // Initialize steps with checklists from template
        this.steps = template.map((t, index) => ({
            id: t.id || index + 1,
            title: t.title,
            completed: false,
            completedAt: null,
            notes: "",
            checklist: (t.defaultChecklist || []).map(text => ({
                text: text,
                checked: false
            }))
        }));
    }
}

// --- Storage Manager ---

// --- Firestore Manager (Replaces LocalStorage) ---

import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

class FirestoreManager {
    static get accessCode() {
        return sessionStorage.getItem('protracker_access_code');
    }

    static setAccessCode(code) {
        sessionStorage.setItem('protracker_access_code', code);
    }

    static clearAccessCode() {
        sessionStorage.removeItem('protracker_access_code');
    }

    // Check if workspace exists
    static async checkWorkspace(code) {
        try {
            const docRef = doc(db, 'workspaces', code);
            const docSnap = await getDoc(docRef);
            return docSnap.exists();
        } catch (error) {
            console.error("Error checking workspace:", error);
            throw error;
        }
    }

    // Create new workspace or overwrite existing
    static async saveWorkspace(data) {
        const code = this.accessCode;
        if (!code) throw new Error('No access code set');

        try {
            const docRef = doc(db, 'workspaces', code);
            // Firestore cannot save custom class instances (like new Project()). 
            // We must convert them to plain objects first.
            const plainData = JSON.parse(JSON.stringify(data));

            await setDoc(docRef, {
                ...plainData,
                lastAccessedAt: new Date().toISOString()
            }, { merge: true });
        } catch (error) {
            console.error("Error saving workspace:", error);
            // Show detailed error to user
            alert(`บันทึกข้อมูลไม่สำเร็จ! \nError: ${error.message}\nCode: ${error.code || 'unknown'}`);
        }
    }

    // Get full workspace data
    static async getWorkspaceData() {
        const code = this.accessCode;
        if (!code) return null;

        try {
            const docRef = doc(db, 'workspaces', code);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                return docSnap.data();
            }
            return null;
        } catch (error) {
            console.error("Error fetching workspace:", error);
            return null;
        }
    }

    // --- Legacy Adapter Methods (to match old usage) ---

    static async getProjects() {
        const data = await this.getWorkspaceData();
        return data?.projects || [];
    }

    static async addProject(project) {
        const projects = await this.getProjects();
        projects.unshift(project); // Add to top
        await this.saveWorkspace({ projects });
        return projects;
    }

    static async updateProject(updatedProject) {
        const projects = await this.getProjects();
        const index = projects.findIndex(p => p.id === updatedProject.id);
        if (index !== -1) {
            projects[index] = updatedProject;
            await this.saveWorkspace({ projects });
        }
        return projects;
    }

    static async deleteProject(id) {
        let projects = await this.getProjects();
        projects = projects.filter(p => p.id !== id);
        await this.saveWorkspace({ projects });
        return projects;
    }

    static async getProject(id) {
        const projects = await this.getProjects();
        return projects.find(p => p.id === id);
    }

    static async updateWorkspaceSettings(code, settings) {
        try {
            const docRef = doc(db, 'workspaces', code);
            await setDoc(docRef, settings, { merge: true });
        } catch (error) {
            console.error("Error updating settings:", error);
            throw error;
        }
    }
}

// --- UI Logic ---

class App {
    constructor() {
        this.currentView = 'dashboard';
        this.activeProject = null;
        this.stepsTemplate = JSON.parse(JSON.stringify(STEPS_TEMPLATE)); // Default

        this.initElements();
        this.initEventListeners();
        this.initSettings(); // New
        this.renderCurrentDate();

        this.initAccessCodeSystem();
    }

    initElements() {
        this.navItems = document.querySelectorAll('.nav-item');
        this.views = document.querySelectorAll('.view-section');
        this.pageTitle = document.getElementById('page-header-title');

        this.modalCreate = document.getElementById('modal-create');
        this.btnCreateProject = document.getElementById('btn-create-project');
        this.btnCloseModal = document.querySelectorAll('.close-modal');
        this.formCreate = document.getElementById('form-create-project');

        // Access Code Modal
        this.modalAccessCode = document.getElementById('modal-access-code');
        this.formAccessCode = document.getElementById('form-access-code');
        this.inpAccessCode = document.getElementById('inp-access-code');
        this.migrationOption = document.getElementById('migration-option');
        this.btnMigrate = document.getElementById('btn-migrate');

        this.projectsGrid = document.getElementById('projects-grid');
        this.searchInput = document.getElementById('search-input');
        this.filterStatus = document.getElementById('filter-status');

        this.btnBack = document.getElementById('btn-back-projects');
        this.btnDeleteProject = document.getElementById('btn-delete-project');
        this.detailTitle = document.getElementById('detail-title');
        this.detailStatus = document.getElementById('detail-status');
        this.detailDesc = document.getElementById('detail-desc');
        this.detailStartDate = document.getElementById('detail-start-date');
        this.detailDeadline = document.getElementById('detail-deadline');
        this.detailBudget = document.getElementById('detail-budget');
        this.detailOverallProgress = document.getElementById('detail-overall-progress');
        this.detailProgressPercent = document.getElementById('detail-progress-percent');

        this.workflowTabs = document.getElementById('workflow-tabs');
        this.stepTitle = document.getElementById('step-title');
        this.btnCompleteStep = document.getElementById('btn-complete-step');
        this.checklistItems = document.getElementById('checklist-items');
        this.inpChecklist = document.getElementById('new-checklist-input');
        this.btnAddChecklist = document.getElementById('btn-add-checklist');
        this.txtNotes = document.getElementById('step-notes');

        this.statTotal = document.getElementById('stat-total');
        this.statProgress = document.getElementById('stat-progress');
        this.statCompleted = document.getElementById('stat-completed');
        this.statUrgent = document.getElementById('stat-urgent');
        this.activityList = document.getElementById('activity-list');
    }

    initEventListeners() {
        // Access Code Handlers
        this.formAccessCode.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAccessCodeSubmit();
        });

        this.btnMigrate.addEventListener('click', () => {
            this.handleMigration();
        });

        this.navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const viewTarget = item.dataset.view;
                if (!viewTarget) return; // Ignore if no view target (like Settings)

                this.loadView(viewTarget);
                this.navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
            });
        });

        this.btnCreateProject.addEventListener('click', () => {
            this.modalCreate.classList.add('open');
        });

        this.btnCloseModal.forEach(btn => {
            btn.addEventListener('click', () => {
                this.modalCreate.classList.remove('open');
            });
        });

        const inpBudget = document.getElementById('inp-project-budget');
        inpBudget.addEventListener('blur', (e) => {
            const val = e.target.value.replace(/,/g, '');
            if (!isNaN(val) && val !== '') {
                e.target.value = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(val);
            }
        });

        inpBudget.addEventListener('focus', (e) => {
            const val = e.target.value.replace(/,/g, '');
            if (!isNaN(val) && val !== '') {
                e.target.value = val;
            }
        });

        this.formCreate.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCreateProject();
        });

        const statCards = document.querySelectorAll('.stat-card');
        if (statCards.length >= 4) {
            statCards[0].style.cursor = 'pointer';
            statCards[0].addEventListener('click', () => {
                this.filterStatus.value = 'all';
                this.loadView('projects');
            });
            statCards[1].style.cursor = 'pointer';
            statCards[1].addEventListener('click', () => {
                this.filterStatus.value = 'active';
                this.loadView('projects');
            });
            statCards[2].style.cursor = 'pointer';
            statCards[2].addEventListener('click', () => {
                this.filterStatus.value = 'completed';
                this.loadView('projects');
            });
            statCards[3].style.cursor = 'pointer';
            statCards[3].addEventListener('click', () => {
                this.filterStatus.value = 'urgent';
                this.loadView('projects');
            });
        }

        this.searchInput.addEventListener('input', () => this.renderProjectsList());
        this.filterStatus.addEventListener('change', () => this.renderProjectsList());

        this.btnBack.addEventListener('click', () => {
            this.loadView('projects');
            this.activeProject = null;
        });

        this.btnDeleteProject.addEventListener('click', async () => {
            if (confirm('คุณแน่ใจหรือไม่ที่จะลบโครงการนี้?')) {
                await FirestoreManager.deleteProject(this.activeProject.id);
                this.showToast('ลบโครงการเรียบร้อยแล้ว', 'success');
                this.loadView('projects');
            }
        });

        this.btnAddChecklist.addEventListener('click', () => this.addChecklistItem());
        this.inpChecklist.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addChecklistItem();
        });

        this.txtNotes.addEventListener('change', async () => {
            if (!this.activeProject) return;
            const currentStep = this.activeProject.steps[this.activeWorkflowStepIndex];
            currentStep.notes = this.txtNotes.value;
            await FirestoreManager.updateProject(this.activeProject);
        });

        this.btnCompleteStep.addEventListener('click', () => this.toggleStepCompletion());
    }

    async initAccessCodeSystem() {
        const code = FirestoreManager.accessCode;

        const oldData = localStorage.getItem('protracker_projects');
        if (oldData && JSON.parse(oldData).length > 0) {
            this.migrationOption.style.display = 'block';
        }

        if (code) {
            this.modalAccessCode.classList.remove('open');
            onSnapshot(doc(db, 'workspaces', code), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();

                    // Load custom steps template if exists
                    if (data.customSteps) {
                        this.stepsTemplate = data.customSteps;
                    }

                    if (this.currentView === 'dashboard') this.renderDashboard();
                    if (this.currentView === 'projects') this.renderProjectsList();
                    if (this.currentView === 'detail' && this.activeProject) {
                        const projects = data.projects || [];
                        const updatedProject = projects.find(p => p.id === this.activeProject.id);
                        if (updatedProject) {
                            this.activeProject = updatedProject;
                            this.openProjectDetail(this.activeProject.id); // Refresh detail view UI
                        }
                    }
                }
            });
            this.loadView('dashboard');
        } else {
            this.modalAccessCode.classList.add('open');
        }
    }

    async handleAccessCodeSubmit() {
        const code = this.inpAccessCode.value.trim();
        if (!code) return;

        FirestoreManager.setAccessCode(code);

        try {
            const exists = await FirestoreManager.checkWorkspace(code);
            if (!exists) {
                alert(`สร้าง Workspace ใหม่สำหรับรหัส "${code}" เรียบร้อยแล้ว`);
                await FirestoreManager.saveWorkspace({ projects: [] });
            } else {
                this.showToast(`เข้าสู่ระบบด้วยรหัส "${code}" เรียบร้อย`, 'success');
            }
            this.initAccessCodeSystem();
        } catch (e) {
            console.error(e);
            alert("เกิดข้อผิดพลาดในการเชื่อมต่อ Firebase: " + e.message);
        }
    }

    async handleMigration() {
        const code = this.inpAccessCode.value.trim();
        if (!code) {
            alert("กรุณากรอกรหัส Access Code ก่อนกดปุ่มย้ายข้อมูล");
            return;
        }

        if (!confirm(`ยืนยันการย้ายข้อมูลไปยังรหัส "${code}"? ข้อมูลเก่าในเครื่องจะถูกลบหลังจากย้ายสำเร็จ`)) return;

        try {
            const oldData = localStorage.getItem('protracker_projects');
            const projects = JSON.parse(oldData);

            FirestoreManager.setAccessCode(code);
            await FirestoreManager.saveWorkspace({ projects });

            localStorage.removeItem('protracker_projects');
            this.migrationOption.style.display = 'none';

            alert("ย้ายข้อมูลสำเร็จ!");
            this.initAccessCodeSystem();

        } catch (e) {
            console.error(e);
            alert("เกิดข้อผิดพลาดในการย้ายข้อมูล: " + e.message);
        }
    }

    renderCurrentDate() {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('current-date').textContent = new Date().toLocaleDateString('th-TH', options);
    }

    loadView(viewName) {
        this.views.forEach(view => view.classList.remove('active'));

        const targetSection = document.getElementById(`view-${viewName}`);
        if (targetSection) targetSection.classList.add('active');

        this.currentView = viewName;

        if (viewName === 'dashboard') {
            this.pageTitle.textContent = 'ภาพรวม';
            this.renderDashboard();
        } else if (viewName === 'projects') {
            this.pageTitle.textContent = 'โครงการทั้งหมด';
            this.renderProjectsList();
        } else if (viewName === 'detail') {
            this.pageTitle.textContent = 'รายละเอียดโครงการ';
        }
    }

    async handleCreateProject() {
        const name = document.getElementById('inp-project-name').value;
        const desc = document.getElementById('inp-project-desc').value;

        let budgetRaw = document.getElementById('inp-project-budget').value;
        budgetRaw = budgetRaw.replace(/,/g, '');
        const budget = parseFloat(budgetRaw);

        const deadline = document.getElementById('inp-project-deadline').value;

        const newProject = new Project(name, desc, budget, deadline, this.stepsTemplate);
        await FirestoreManager.addProject(newProject);

        this.modalCreate.classList.remove('open');
        this.formCreate.reset();
        this.showToast('สร้างโครงการสำเร็จแล้ว', 'success');

        this.renderDashboard();
        this.loadView('projects');
    }

    async renderDashboard() {
        const projects = await FirestoreManager.getProjects();

        const total = projects.length;
        const completed = projects.filter(p => p.status === 'completed').length;
        const inProgress = total - completed;

        const now = new Date();
        const urgent = projects.filter(p => {
            if (p.status === 'completed' || !p.deadline) return false;
            const d = new Date(p.deadline);
            const diffTime = d - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= 7;
        }).length;

        this.statTotal.textContent = total;
        this.statProgress.textContent = inProgress;
        this.statCompleted.textContent = completed;
        this.statUrgent.textContent = urgent;

        this.activityList.innerHTML = '';
        const recentProjects = projects.slice(0, 5);

        if (recentProjects.length === 0) {
            this.activityList.innerHTML = '<div class="empty-state-small">ยังไม่มีกิจกรรม</div>';
            return;
        }

        recentProjects.forEach(p => {
            const div = document.createElement('div');
            div.className = 'activity-item';
            div.style.padding = '0.75rem 0';
            div.style.borderBottom = '1px solid var(--border-color)';
            div.style.cursor = 'pointer';
            div.style.transition = 'background-color 0.2s';

            div.addEventListener('mouseenter', () => div.style.backgroundColor = 'rgba(255,255,255,0.02)');
            div.addEventListener('mouseleave', () => div.style.backgroundColor = 'transparent');

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:500;">${p.name}</span>
                    <span style="font-size:0.8rem; color:var(--text-muted);">${new Date(p.createdAt).toLocaleDateString('th-TH')}</span>
                </div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.25rem;">
                    สถานะ: ${p.status === 'completed' ? 'เสร็จสิ้น' : `ขั้นตอนที่ ${p.currentStepIndex + 1}/${p.steps.length}`}
                </div>
            `;

            div.addEventListener('click', () => {
                this.openProjectDetail(p.id);
            });

            this.activityList.appendChild(div);
        });
    }

    async renderProjectsList() {
        const projects = await FirestoreManager.getProjects();
        const searchTerm = this.searchInput.value.toLowerCase();
        const filter = this.filterStatus.value;

        this.projectsGrid.innerHTML = '';

        const filtered = projects.filter(p => {
            const matchesSearch = p.name.toLowerCase().includes(searchTerm) || (p.description && p.description.toLowerCase().includes(searchTerm));

            let matchesFilter = true;
            if (filter === 'all') matchesFilter = true;
            else if (filter === 'active') matchesFilter = p.status === 'active';
            else if (filter === 'completed') matchesFilter = p.status === 'completed';
            else if (filter === 'urgent') {
                if (p.status === 'completed' || !p.deadline) matchesFilter = false;
                else {
                    const d = new Date(p.deadline);
                    const now = new Date();
                    const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
                    matchesFilter = diffDays >= 0 && diffDays <= 7;
                }
            }
            return matchesSearch && matchesFilter;
        });

        if (filtered.length === 0) {
            this.projectsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 2rem; color: var(--text-muted);">ไม่พบโครงการ</div>';
            return;
        }

        filtered.forEach(p => {
            const card = document.createElement('div');
            card.className = 'project-card';

            const budgetFormatted = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(p.budget);
            const progress = Math.round(((p.currentStepIndex) / p.steps.length) * 100);

            let statusClass = 'status-active';
            let statusText = 'กำลังดำเนินการ';
            if (p.status === 'completed') {
                statusClass = 'status-completed';
                statusText = 'เสร็จสิ้น';
            } else if (p.deadline) {
                const dayDiff = Math.ceil((new Date(p.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                if (dayDiff < 3 && dayDiff >= 0) {
                    statusClass = 'status-urgent';
                }
            }

            card.innerHTML = `
                <div class="card-header">
                    <div>
                        <h3>${p.name}</h3>
                        <div class="card-date"><i class="fa-regular fa-clock"></i> ${new Date(p.createdAt).toLocaleDateString('th-TH')}</div>
                         <div style="font-size: 0.9rem; color: var(--text-muted); margin-top: 0.25rem;">
                            <i class="fa-solid fa-coins"></i> ${budgetFormatted}
                        </div>
                    </div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="card-steps">
                    <div class="step-info">
                        <span>ขั้นตอนที่ ${p.currentStepIndex + 1}: ${p.steps[p.currentStepIndex].title}</span>
                        <span>${progress}%</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${progress}%"></div>
                    </div>
                </div>
            `;

            card.addEventListener('click', () => this.openProjectDetail(p.id));
            this.projectsGrid.appendChild(card);
        });
    }

    async openProjectDetail(id) {
        const project = await FirestoreManager.getProject(id);
        if (!project) return;

        this.activeProject = project;
        this.loadView('detail');

        this.detailTitle.textContent = project.name;
        this.detailStatus.textContent = project.status === 'completed' ? 'เสร็จสิ้น' : 'กำลังดำเนินการ';
        this.detailDesc.textContent = project.description || 'ไม่มีรายละเอียด';
        this.detailStartDate.textContent = new Date(project.createdAt).toLocaleDateString('th-TH');
        this.detailDeadline.textContent = project.deadline ? new Date(project.deadline).toLocaleDateString('th-TH') : '-';
        this.detailBudget.textContent = new Intl.NumberFormat('th-TH').format(project.budget);

        const percent = Math.round(((project.currentStepIndex) / project.steps.length) * 100);
        this.detailOverallProgress.style.width = `${percent}%`;
        this.detailProgressPercent.textContent = `${percent}%`;

        this.renderWorkflowTabs();
        this.loadWorkflowStep(project.currentStepIndex);
    }

    renderWorkflowTabs() {
        this.workflowTabs.innerHTML = '';

        this.activeProject.steps.forEach((step, index) => {
            const tab = document.createElement('div');
            tab.className = `step-tab ${index === this.activeProject.currentStepIndex ? 'active' : ''} ${step.completed ? 'completed' : ''}`;

            let icon = `<i class="fa-regular fa-circle"></i>`;
            if (step.completed) icon = `<i class="fa-solid fa-circle-check"></i>`;

            tab.innerHTML = `${icon} ${step.title}`;
            tab.addEventListener('click', () => this.loadWorkflowStep(index));
            this.workflowTabs.appendChild(tab);
        });
    }

    loadWorkflowStep(index) {
        this.activeWorkflowStepIndex = index;
        const stepData = this.activeProject.steps[index];

        // Update Tabs UI
        const tabs = this.workflowTabs.querySelectorAll('.step-tab');
        tabs.forEach(t => t.classList.remove('active'));
        if (tabs[index]) tabs[index].classList.add('active');

        // Render Content
        this.stepTitle.textContent = `${index + 1}. ${stepData.title}`;
        this.txtNotes.value = stepData.notes || '';

        // Button Logic
        if (stepData.completed) {
            this.btnCompleteStep.innerHTML = '<i class="fa-solid fa-rotate-left"></i> ย้อนกลับสถานะ';
            this.btnCompleteStep.classList.remove('btn-primary');
            this.btnCompleteStep.classList.add('btn-outline');
        } else {
            this.btnCompleteStep.innerHTML = '<i class="fa-regular fa-circle-check"></i> ทำขั้นตอนเสร็จสิ้น';
            this.btnCompleteStep.classList.add('btn-outline'); // Standard outline
            // Highlight if it's the current active step
            if (index === this.activeProject.currentStepIndex) {
                this.btnCompleteStep.classList.add('btn-primary');
                this.btnCompleteStep.classList.remove('btn-outline');
            }
        }

        // Render Checklist
        this.checklistItems.innerHTML = '';
        stepData.checklist.forEach((item, itemIndex) => {
            this.renderChecklistItem(item, itemIndex);
        });
    }

    renderChecklistItem(item, index) {
        const li = document.createElement('li');
        li.className = `checklist-item ${item.checked ? 'checked' : ''}`;

        li.innerHTML = `
            <input type="checkbox" ${item.checked ? 'checked' : ''}>
            <span class="checklist-text">${item.text}</span>
            <button class="btn-delete-item"><i class="fa-solid fa-times"></i></button>
        `;

        const checkbox = li.querySelector('input');
        checkbox.addEventListener('change', async () => {
            item.checked = checkbox.checked;
            li.classList.toggle('checked', item.checked);
            await FirestoreManager.updateProject(this.activeProject);
        });

        const deleteBtn = li.querySelector('.btn-delete-item');
        deleteBtn.addEventListener('click', async () => {
            this.activeProject.steps[this.activeWorkflowStepIndex].checklist.splice(index, 1);
            await FirestoreManager.updateProject(this.activeProject);
            this.loadWorkflowStep(this.activeWorkflowStepIndex); // Re-render
        });

        this.checklistItems.appendChild(li);
    }

    async addChecklistItem() {
        const text = this.inpChecklist.value.trim();
        if (!text) return;

        const currentStep = this.activeProject.steps[this.activeWorkflowStepIndex];
        currentStep.checklist.push({ text: text, checked: false });

        await FirestoreManager.updateProject(this.activeProject);

        this.inpChecklist.value = '';
        this.loadWorkflowStep(this.activeWorkflowStepIndex);
    }

    async toggleStepCompletion() {
        if (!this.activeProject) return;

        const stepIndex = this.activeWorkflowStepIndex;
        const step = this.activeProject.steps[stepIndex];

        step.completed = !step.completed;

        if (step.completed) {
            step.completedAt = new Date().toISOString();
            // If this was the current step, move pointer forward
            if (stepIndex === this.activeProject.currentStepIndex && stepIndex < this.activeProject.steps.length - 1) {
                this.activeProject.currentStepIndex = stepIndex + 1;
            }
            // Check if all steps done
            const allDone = this.activeProject.steps.every(s => s.completed);
            if (allDone) this.activeProject.status = 'completed';

            this.showToast(`บันทึกขั้นตอนที่ ${stepIndex + 1} เสร็จสิ้น`, 'success');
        } else {
            step.completedAt = null;
            // If we uncheck a step, should we move pointer back? 
            // Logic: stick pointer to the first incomplete step
            this.activeProject.status = 'active'; // Re-open if closed

            // Simplest logic: just update timestamp and status, let user navigate
            this.showToast(`ยกเลิกสถานะเสร็จสิ้น ขั้นตอนที่ ${stepIndex + 1}`, 'info');
        }

        await FirestoreManager.updateProject(this.activeProject);

        // Refresh View
        this.loadWorkflowStep(stepIndex);
        this.renderWorkflowTabs();

        // specific: update progress bar in detail view
        const percent = Math.round(((this.activeProject.currentStepIndex) / this.activeProject.steps.length) * 100);
        this.detailOverallProgress.style.width = `${percent}%`;
        this.detailProgressPercent.textContent = `${percent}%`;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let icon = '<i class="fa-solid fa-info-circle"></i>';
        if (type === 'success') icon = '<i class="fa-solid fa-check-circle"></i>';
        if (type === 'warning') icon = '<i class="fa-solid fa-exclamation-triangle"></i>';

        toast.innerHTML = `${icon} <span>${message}</span>`;

        document.getElementById('toast-container').appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    initSettings() {
        this.navSettings = document.getElementById('nav-settings');
        this.modalSettings = document.getElementById('modal-settings');
        this.settingsStepsContainer = document.getElementById('settings-steps-container');
        this.btnResetSteps = document.getElementById('btn-reset-steps');
        this.btnSaveSettings = document.getElementById('btn-save-settings');

        // Edit Step Modal Elements
        // Since we injected HTML dynamically, these might be null if not in DOM?
        // Wait, I put them in index.html. They should be there.
        const modalEditStep = document.getElementById('modal-edit-step');
        if (!modalEditStep) {
            console.error("Modal Edit Step not found!");
            return;
        }

        this.modalEditStep = modalEditStep;
        this.inpEditStepTitle = document.getElementById('edit-step-title');
        this.inpEditStepChecklist = document.getElementById('edit-step-checklist');
        this.inpEditStepId = document.getElementById('edit-step-id');
        this.btnConfirmStepEdit = document.getElementById('btn-confirm-step-edit');

        // Nav Click
        if (this.navSettings) {
            this.navSettings.addEventListener('click', (e) => {
                e.preventDefault();
                this.openSettingsModal();
            });
        }

        // Close Modals
        if (this.modalSettings) {
            this.modalSettings.querySelector('.close-modal').addEventListener('click', () => {
                this.modalSettings.classList.remove('open');
            });
        }

        if (this.modalEditStep) {
            const closeBtn = this.modalEditStep.querySelector('.close-modal-step');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                this.modalEditStep.classList.remove('open');
            });
            const cancelBtn = this.modalEditStep.querySelector('.btn-text');
            if (cancelBtn) cancelBtn.addEventListener('click', () => {
                this.modalEditStep.classList.remove('open');
            });
        }

        // Reset
        if (this.btnResetSteps) {
            this.btnResetSteps.addEventListener('click', () => {
                if (confirm('คุณแน่ใจหรือไม่ที่จะคืนค่าเริ่มต้น? การแก้ไขทั้งหมดจะหายไป')) {
                    this.tempStepsTemplate = JSON.parse(JSON.stringify(STEPS_TEMPLATE));
                    this.renderSettingsSteps();
                }
            });
        }

        // Save
        if (this.btnSaveSettings) {
            this.btnSaveSettings.addEventListener('click', async () => {
                const code = FirestoreManager.accessCode;
                if (!code) {
                    this.showToast('ไม่พบรหัสการเข้าถึง กรุณาลองใหม่', 'error');
                    return;
                }
                try {
                    // Update local state
                    this.stepsTemplate = JSON.parse(JSON.stringify(this.tempStepsTemplate));

                    // Fetch current projects to sync titles
                    const workspace = await FirestoreManager.getWorkspaceData();
                    const projects = workspace.projects || [];

                    // Propagate title changes to projects with the same step count
                    projects.forEach(p => {
                        if (p.steps && p.steps.length === this.stepsTemplate.length) {
                            p.steps.forEach((s, idx) => {
                                s.title = this.stepsTemplate[idx].title;
                            });
                        }
                    });

                    // Save to Firestore (Update both customSteps and projects)
                    await FirestoreManager.updateWorkspaceSettings(code, {
                        customSteps: this.stepsTemplate,
                        projects: projects
                    });

                    this.showToast('บันทึกการตั้งค่าและอัปเดตโครงการทั้งหมดแล้ว', 'success');
                    this.modalSettings.classList.remove('open');
                } catch (error) {
                    console.error(error);
                    this.showToast('บันทึกไม่สำเร็จ: ' + error.message, 'error');
                }
            });
        }

        // Confirm Edit Step
        if (this.btnConfirmStepEdit) {
            this.btnConfirmStepEdit.addEventListener('click', () => {
                this.saveStepEdit();
            });
        }
    }

    openSettingsModal() {
        // Clone current template to temp for editing
        this.tempStepsTemplate = JSON.parse(JSON.stringify(this.stepsTemplate));
        this.renderSettingsSteps();
        if (this.modalSettings) this.modalSettings.classList.add('open');
    }

    renderSettingsSteps() {
        if (!this.settingsStepsContainer) return;
        this.settingsStepsContainer.innerHTML = '';

        if (!this.tempStepsTemplate) this.tempStepsTemplate = [];

        this.tempStepsTemplate.forEach((step, index) => {
            const div = document.createElement('div');
            div.className = 'step-setting-item';
            div.innerHTML = `
                <div class="step-setting-info">
                    Step ${index + 1}: ${step.title}
                    <div style="font-size:0.8rem; color:var(--text-muted); font-weight:normal;">
                        ${step.defaultChecklist ? step.defaultChecklist.length : 0} รายการตรวจสอบ
                    </div>
                </div>
                <div class="step-setting-actions">
                    <button class="btn-icon btn-edit-step" data-index="${index}"><i class="fa-solid fa-pen"></i></button>
                </div>
            `;

            const editBtn = div.querySelector('.btn-edit-step');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    this.openEditStepModal(index);
                });
            }

            this.settingsStepsContainer.appendChild(div);
        });
    }

    openEditStepModal(index) {
        const step = this.tempStepsTemplate[index];
        if (this.inpEditStepId) this.inpEditStepId.value = index;
        if (this.inpEditStepTitle) this.inpEditStepTitle.value = step.title;
        if (this.inpEditStepChecklist) this.inpEditStepChecklist.value = (step.defaultChecklist || []).join('\n');

        if (this.modalEditStep) this.modalEditStep.classList.add('open');
    }

    saveStepEdit() {
        const index = parseInt(this.inpEditStepId.value);
        const newTitle = this.inpEditStepTitle.value.trim();
        const checklistStr = this.inpEditStepChecklist.value;
        const newChecklist = checklistStr.split('\n').map(s => s.trim()).filter(s => s);

        if (!newTitle) {
            alert('กรุณาระบุชื่อขั้นตอน');
            return;
        }

        if (this.tempStepsTemplate[index]) {
            this.tempStepsTemplate[index].title = newTitle;
            this.tempStepsTemplate[index].defaultChecklist = newChecklist;
        }

        this.renderSettingsSteps();
        if (this.modalEditStep) this.modalEditStep.classList.remove('open');
    }
}

// Start App
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
