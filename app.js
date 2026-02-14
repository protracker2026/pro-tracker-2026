/**
 * Procurement Tracker App
 * Vanilla JS implementation with localStorage
 */

// --- Data Models & Constants ---

const STEPS_TEMPLATE = [
    {
        id: 1,
        title: "สำรวจความต้องการ",
        defaultChecklist: []
    },
    {
        id: 2,
        title: "จัดทำรายละเอียด/TOR",
        defaultChecklist: []
    },
    {
        id: 3,
        title: "ประมาณราคากลาง",
        defaultChecklist: []
    },
    {
        id: 4,
        title: "ขออนุมัติจัดซื้อ/จัดจ้าง",
        defaultChecklist: []
    },
    {
        id: 5,
        title: "ดำเนินการจัดซื้อ/จัดจ้าง",
        defaultChecklist: []
    },
    {
        id: 6,
        title: "ตรวจรับพัสดุ/งานจ้าง",
        defaultChecklist: []
    },
    {
        id: 7,
        title: "เบิกจ่ายเงิน",
        defaultChecklist: []
    }
];

const PRIORITY_LABELS = {
    'normal': { label: 'ปกติ', class: 'priority-normal', icon: 'fa-solid fa-circle-check' },
    'urgent': { label: 'ด่วน', class: 'priority-urgent', icon: 'fa-solid fa-bolt' },
    'very-urgent': { label: 'ด่วนมาก', class: 'priority-very-urgent', icon: 'fa-solid fa-angles-up' },
    'most-urgent': { label: 'ด่วนที่สุด', class: 'priority-most-urgent', icon: 'fa-solid fa-fire' },
    'extreme': { label: 'ด่วนชิบหาย', class: 'priority-extreme', icon: 'fa-solid fa-skull-crossbones' }
};

class Project {
    constructor(name, description, budget, deadline, priority = 'normal', template = STEPS_TEMPLATE) {
        this.id = Date.now().toString(); // Simple ID generation
        this.name = name;
        this.description = description;
        this.budget = parseFloat(budget) || 0;
        this.deadline = deadline || null;
        this.priority = priority;
        this.createdAt = new Date().toISOString();
        this.status = 'active'; // active, completed
        this.currentStepIndex = 0; // 0-based index (0 = Step 1)

        // Initialize steps with checklists from template
        this.steps = template.map((t, index) => ({
            id: t.id || index + 1,
            title: t.title,
            completed: false,
            completedAt: null,
            notes: [],
            checklist: (t.defaultChecklist || []).map(text => ({
                text: text,
                checked: false,
                completedAt: null
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
        this.noteViewMode = localStorage.getItem('protracker_note_view') || 'timeline';
        this.activeWorkflowStepIndex = 0;

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
        this.btnAddProject = document.getElementById('btn-add-project');
        this.formCreateProject = document.getElementById('form-create-project');
        this.inpProjectName = document.getElementById('inp-project-name');
        this.inpProjectDesc = document.getElementById('inp-project-desc');
        this.inpProjectBudget = document.getElementById('inp-project-budget');
        this.inpProjectDeadline = document.getElementById('inp-project-deadline');
        this.inpProjectPriority = document.getElementById('inp-project-priority');

        // Edit Project Info Modal Elements
        this.modalEditProject = document.getElementById('modal-edit-project');
        this.formEditProject = document.getElementById('form-edit-project');
        this.btnEditProjectInfo = document.getElementById('btn-edit-project-info');
        this.editProjectId = document.getElementById('edit-project-id');
        this.editProjectName = document.getElementById('edit-project-name');
        this.editProjectDesc = document.getElementById('edit-project-desc');
        this.editProjectBudget = document.getElementById('edit-project-budget');
        this.editProjectPriority = document.getElementById('edit-project-priority');
        this.editProjectDeadline = document.getElementById('edit-project-deadline');

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
        this.btnExportPdf = document.getElementById('btn-export-pdf');
        this.detailTitle = document.getElementById('detail-title');
        this.detailStatus = document.getElementById('detail-status');
        this.detailDesc = document.getElementById('detail-desc');
        this.detailStartDate = document.getElementById('detail-start-date');
        this.detailDeadline = document.getElementById('detail-deadline');
        this.detailBudget = document.getElementById('detail-budget');
        this.detailPriority = document.getElementById('detail-priority'); // Add this to HTML later or use a span
        this.detailOverallProgress = document.getElementById('detail-overall-progress');
        this.detailProgressPercent = document.getElementById('detail-progress-percent');

        this.workflowTabs = document.getElementById('workflow-tabs');
        this.btnEditProjectWorkflow = document.getElementById('btn-edit-project-workflow');
        this.stepTitle = document.getElementById('step-title');
        this.btnCompleteStep = document.getElementById('btn-complete-step');
        this.checklistItems = document.getElementById('checklist-items');
        this.inpChecklist = document.getElementById('new-checklist-input');
        this.inpChecklistDeadline = document.getElementById('new-checklist-deadline');
        this.btnAddChecklist = document.getElementById('btn-add-checklist');
        this.inpTimeline = document.getElementById('timeline-input');
        this.btnAddTimeline = document.getElementById('btn-add-timeline');
        this.timelineList = document.getElementById('timeline-list');
        this.inpPostit = document.getElementById('postit-input');
        this.btnAddPostit = document.getElementById('btn-add-postit');
        this.postitsList = document.getElementById('postits-list');

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
                const modal = btn.closest('.modal');
                if (modal) modal.classList.remove('open');
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

        this.formCreateProject.addEventListener('submit', (e) => {
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

        if (this.btnExportPdf) {
            this.btnExportPdf.addEventListener('click', () => this.exportToPDF());
        }

        if (this.btnEditProjectInfo) {
            this.btnEditProjectInfo.addEventListener('click', () => {
                if (!this.activeProject) return;
                const p = this.activeProject;
                this.editProjectId.value = p.id;
                this.editProjectName.value = p.name;
                this.editProjectDesc.value = p.description || '';
                this.editProjectBudget.value = p.budget || '';
                this.editProjectPriority.value = p.priority || 'normal';
                this.editProjectDeadline.value = p.deadline || '';
                this.modalEditProject.classList.add('open');
            });
        }

        if (this.formEditProject) {
            this.formEditProject.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!this.activeProject) return;

                const updatedData = {
                    ...this.activeProject,
                    name: this.editProjectName.value.trim(),
                    description: this.editProjectDesc.value.trim(),
                    budget: parseFloat(this.editProjectBudget.value) || 0,
                    priority: this.editProjectPriority.value,
                    deadline: this.editProjectDeadline.value
                };

                await FirestoreManager.updateProject(updatedData);
                this.activeProject = updatedData;
                this.modalEditProject.classList.remove('open');
                this.openProjectDetail(updatedData.id); // Refresh detail view
                this.showToast('แก้ไขข้อมูลโครงการเรียบร้อยแล้ว', 'success');
            });
        }

        this.btnAddChecklist.addEventListener('click', () => this.addChecklistItem());
        this.inpChecklist.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addChecklistItem();
        });

        this.btnAddTimeline.addEventListener('click', () => this.addTimelineEntry());
        this.inpTimeline.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.addTimelineEntry();
            }
        });

        this.btnAddPostit.addEventListener('click', () => this.addPostit());
        this.inpPostit.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.addPostit();
            }
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
                            // Pass the currently viewed step index to prevent jumping back to step 1
                            this.openProjectDetail(this.activeProject.id, this.activeWorkflowStepIndex);
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
        const name = this.inpProjectName.value.trim();
        const desc = this.inpProjectDesc.value.trim();
        const priority = this.inpProjectPriority ? this.inpProjectPriority.value : 'normal';

        let budgetRaw = this.inpProjectBudget.value;
        budgetRaw = budgetRaw.replace(/,/g, '');
        const budget = parseFloat(budgetRaw) || 0;

        const deadline = this.inpProjectDeadline.value;

        const newProject = new Project(name, desc, budget, deadline, priority, this.stepsTemplate);
        await FirestoreManager.addProject(newProject);

        this.modalCreate.classList.remove('open');
        this.formCreateProject.reset();
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

            const priorityCfg = PRIORITY_LABELS[p.priority] || PRIORITY_LABELS['normal'];
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <span style="font-weight:500;">${p.name}</span>
                            <span class="priority-badge ${priorityCfg.class}" style="font-size:0.6rem; padding: 0.1rem 0.3rem;">
                                <i class="${priorityCfg.icon}"></i> ${priorityCfg.label}
                            </span>
                        </div>
                    <span style="font-size:0.8rem; color:var(--text-muted);">${new Date(p.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
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
            const completedStepsCount = p.steps.filter(s => s.completed).length;
            const progress = Math.round((completedStepsCount / p.steps.length) * 100);

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

            const priorityCfg = PRIORITY_LABELS[p.priority] || PRIORITY_LABELS['normal'];

            // Dynamic logic for Latest Completed and Current Focus
            const lastCompletedIdx = p.steps.map((s, i) => s.completed ? i : -1).filter(i => i !== -1);
            const maxCompletedIdx = lastCompletedIdx.length > 0 ? Math.max(...lastCompletedIdx) : -1;

            const firstIncompleteIdx = p.steps.findIndex(s => !s.completed);
            const currentFocusIdx = firstIncompleteIdx !== -1 ? firstIncompleteIdx : p.steps.length - 1;

            // Build Flow UI
            let stepFlowHtml = '';
            if (p.status === 'completed') {
                stepFlowHtml = `
                    <div class="step-flow-container finished">
                        <div class="flow-item completed">
                            <i class="fa-solid fa-circle-check"></i>
                            <span>${p.steps[p.steps.length - 1].title}</span>
                        </div>
                        <div class="flow-status-tag">สำเร็จ</div>
                    </div>`;
            } else {
                const prevTitle = maxCompletedIdx >= 0 ? p.steps[maxCompletedIdx].title : "เริ่มโครงการ";
                const nextTitle = p.steps[currentFocusIdx].title;

                stepFlowHtml = `
                    <div class="step-flow-container">
                        <div class="flow-item completed">
                            <i class="${maxCompletedIdx >= 0 ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}"></i>
                            <span>${prevTitle}</span>
                        </div>
                        <i class="fa-solid fa-arrow-right flow-arrow"></i>
                        <div class="flow-item next">
                            <span>${nextTitle}</span>
                        </div>
                    </div>`;
            }

            card.innerHTML = `
                <div class="card-top-row">
                    <span class="priority-badge ${priorityCfg.class}">
                        <i class="${priorityCfg.icon}"></i> ${priorityCfg.label}
                    </span>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                
                <div class="card-body">
                    <h3>${p.name}</h3>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <span class="info-badge"><i class="fa-regular fa-calendar"></i> ${new Date(p.createdAt).toLocaleDateString('th-TH')}</span>
                        <span class="info-badge"><i class="fa-solid fa-tag"></i> ${budgetFormatted}</span>
                    </div>
                </div>

                <div class="card-footer">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-muted);">
                        <span>ความคืบหน้า</span>
                        <span style="font-weight: 700; color: var(--text-main)">${progress}%</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${progress}%"></div>
                    </div>
                    ${stepFlowHtml}
                </div>
            `;

            card.addEventListener('click', () => this.openProjectDetail(p.id));
            this.projectsGrid.appendChild(card);
        });
    }

    async openProjectDetail(id, stepIndex = null) {
        const project = await FirestoreManager.getProject(id);
        if (!project) return;

        this.activeProject = project;
        this.loadView('detail');

        this.detailTitle.textContent = project.name;
        this.detailStatus.textContent = project.status === 'completed' ? 'เสร็จสิ้น' : 'กำลังดำเนินการ';
        this.detailDesc.textContent = project.description || 'ไม่มีรายละเอียด';
        this.detailStartDate.textContent = new Date(project.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
        this.detailDeadline.textContent = project.deadline ? new Date(project.deadline).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
        this.detailBudget.textContent = new Intl.NumberFormat('th-TH').format(project.budget);

        const priorityCfg = PRIORITY_LABELS[project.priority] || PRIORITY_LABELS['normal'];
        this.detailPriority.innerHTML = `<i class="${priorityCfg.icon}"></i> ${priorityCfg.label}`;
        this.detailPriority.className = `priority-badge ${priorityCfg.class}`;

        const completedCount = project.steps.filter(s => s.completed).length;
        const percent = Math.round((completedCount / project.steps.length) * 100);
        this.detailOverallProgress.style.width = `${percent}%`;
        this.detailProgressPercent.textContent = `${percent}%`;

        this.renderWorkflowTabs();

        // If stepIndex is provided, use it, otherwise use the project's current progress step
        const targetStep = stepIndex !== null ? stepIndex : project.currentStepIndex;
        this.loadWorkflowStep(targetStep);
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

        // Migrate old logic
        if (typeof stepData.notes === 'string') {
            const oldText = stepData.notes;
            stepData.notes = oldText ? [{ timestamp: new Date().toISOString(), text: oldText, type: 'timeline' }] : [];
        }

        // Migrate and split existing notes into timeline and postits if they aren't already
        if (!stepData.timeline) {
            stepData.timeline = (stepData.notes || []).filter(n => !n.type || n.type === 'timeline');
        }
        if (!stepData.postits) {
            stepData.postits = (stepData.notes || []).filter(n => n.type === 'postit');
        }

        this.renderTimeline();
        this.renderPostits();

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

        // Format date for display
        let dateDisplay = '';
        if (item.completedAt) {
            const dateObj = new Date(item.completedAt);
            dateDisplay = dateObj.toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }

        let deadlineDisplay = '';
        if (item.deadline) {
            const d = new Date(item.deadline);
            deadlineDisplay = `<div class="deadline-badge" title="กำหนดเสร็จ (Deadline)"><i class="fa-solid fa-flag-checkered"></i> ${d.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`;
        }

        const createdAtStr = item.createdAt ? new Date(item.createdAt).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        // Render Item-specific Notes
        const itemNotes = item.notes || [];
        let itemNotesHtml = '';
        if (itemNotes.length > 0) {
            itemNotesHtml = `
                <div class="item-notes-list">
                    ${itemNotes.map((n, ni) => `
                        <div class="item-note">
                            <div class="item-note-header">
                                <span class="info-badge" style="background:none; padding:0; font-size:0.65rem;">
                                    <i class="fa-regular fa-clock"></i> ${new Date(n.timestamp).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button class="btn-delete-item-note" data-index="${ni}" title="ลบบันทึก"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            <div class="item-note-text">${n.text}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        li.innerHTML = `
            <input type="checkbox" ${item.checked ? 'checked' : ''}>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 0.25rem;">
                <span class="checklist-text">${item.text}</span>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
                    <div class="info-badge" title="วันที่เริ่มเพิ่มรายการ">
                        <i class="fa-regular fa-calendar-plus"></i> ${createdAtStr}
                    </div>
                    ${deadlineDisplay}
                    <button class="btn-item-note-toggle" title="เพิ่มบันทึกในรายการนี้"><i class="fa-solid fa-note-sticky"></i> บันทึก</button>
                </div>
                ${itemNotesHtml}
                <div class="add-item-note-box" style="display:none; margin-top: 0.5rem;">
                    <div style="display:flex; gap: 0.25rem;">
                        <input type="text" class="inp-item-note" placeholder="พิมพ์บันทึก..." style="flex:1; font-size:0.85rem; padding: 0.3rem 0.6rem;">
                        <button class="btn-save-item-note btn-primary" style="padding: 0.2rem 0.5rem;"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
            </div>
            <div class="checklist-date" title="วันที่เสร็จสิ้น">${dateDisplay || (item.checked ? 'ระบุวันที่' : '')}</div>
            <button class="btn-delete-item"><i class="fa-solid fa-times"></i></button>
        `;

        const checkbox = li.querySelector('input');
        const dateEl = li.querySelector('.checklist-date');
        const noteToggleBtn = li.querySelector('.btn-item-note-toggle');
        const addNoteBox = li.querySelector('.add-item-note-box');
        const saveNoteBtn = li.querySelector('.btn-save-item-note');
        const inpItemNote = li.querySelector('.inp-item-note');

        // Note Toggle
        noteToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = addNoteBox.style.display === 'block';
            addNoteBox.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) inpItemNote.focus();
        });

        // Save Item Note
        const saveItemNote = async () => {
            const val = inpItemNote.value.trim();
            if (!val) return;
            if (!item.notes) item.notes = [];
            item.notes.push({
                text: val,
                timestamp: new Date().toISOString()
            });
            await FirestoreManager.updateProject(this.activeProject);
            this.loadWorkflowStep(this.activeWorkflowStepIndex);
        };

        saveNoteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            saveItemNote();
        });

        inpItemNote.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                saveItemNote();
            }
        });

        // Delete Item Note
        li.querySelectorAll('.btn-delete-item-note').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ni = parseInt(btn.dataset.index);
                if (confirm('ลบบันทึกนี้?')) {
                    item.notes.splice(ni, 1);
                    await FirestoreManager.updateProject(this.activeProject);
                    this.loadWorkflowStep(this.activeWorkflowStepIndex);
                }
            });
        });

        checkbox.addEventListener('change', async () => {
            item.checked = checkbox.checked;
            if (item.checked && !item.completedAt) {
                // Auto set today if not set
                item.completedAt = new Date().toISOString();
            } else if (!item.checked) {
                // Clear date if unchecked (optional, but keep it clean)
                item.completedAt = null;
            }

            li.classList.toggle('checked', item.checked);
            await FirestoreManager.updateProject(this.activeProject);
            this.loadWorkflowStep(this.activeWorkflowStepIndex); // Re-render to show date
        });

        // Manual date edit
        dateEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentVal = item.completedAt ? new Date(item.completedAt).toISOString().slice(0, 16) : '';

            const inp = document.createElement('input');
            inp.type = 'datetime-local';
            inp.className = 'checklist-date-input';
            inp.value = currentVal;

            dateEl.replaceWith(inp);
            inp.focus();

            const saveDate = async () => {
                if (inp.value) {
                    item.completedAt = new Date(inp.value).toISOString();
                    // If date is set manually, maybe item should be checked?
                    // Let's leave checkbox as is, but usually a date implies checked.
                } else {
                    item.completedAt = null;
                }
                await FirestoreManager.updateProject(this.activeProject);
                this.loadWorkflowStep(this.activeWorkflowStepIndex);
            };

            inp.addEventListener('blur', saveDate);
            inp.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') saveDate();
            });
        });

        const deleteBtn = li.querySelector('.btn-delete-item');
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            this.activeProject.steps[this.activeWorkflowStepIndex].checklist.splice(index, 1);
            await FirestoreManager.updateProject(this.activeProject);
            this.loadWorkflowStep(this.activeWorkflowStepIndex);
        });

        this.checklistItems.appendChild(li);
    }

    async addChecklistItem() {
        const text = this.inpChecklist.value.trim();
        const deadline = this.inpChecklistDeadline.value;
        if (!text) return;

        const currentStep = this.activeProject.steps[this.activeWorkflowStepIndex];
        currentStep.checklist.push({
            text: text,
            checked: false,
            createdAt: new Date().toISOString(),
            completedAt: null,
            deadline: deadline || null
        });

        await FirestoreManager.updateProject(this.activeProject);

        this.inpChecklist.value = '';
        // Keep deadline value for efficiency
        this.loadWorkflowStep(this.activeWorkflowStepIndex);
    }

    async toggleStepCompletion() {
        if (!this.activeProject) return;

        const stepIndex = this.activeWorkflowStepIndex;
        const step = this.activeProject.steps[stepIndex];

        step.completed = !step.completed;

        if (step.completed) {
            step.completedAt = new Date().toISOString();
            this.showToast(`บันทึกขั้นตอนที่ ${stepIndex + 1} เสร็จสิ้น`, 'success');
        } else {
            step.completedAt = null;
            this.showToast(`ยกเลิกสถานะเสร็จสิ้น ขั้นตอนที่ ${stepIndex + 1}`, 'info');
        }

        // Recalculate current pointer: first incomplete step
        const firstIncompleteIdx = this.activeProject.steps.findIndex(s => !s.completed);
        if (firstIncompleteIdx !== -1) {
            this.activeProject.currentStepIndex = firstIncompleteIdx;
            this.activeProject.status = 'active';
        } else {
            // All steps are completed
            this.activeProject.currentStepIndex = this.activeProject.steps.length - 1;
            this.activeProject.status = 'completed';
        }

        await FirestoreManager.updateProject(this.activeProject);

        // Refresh View
        this.loadWorkflowStep(stepIndex);
        this.renderWorkflowTabs();

        // update progress bar in detail view
        const completedCount = this.activeProject.steps.filter(s => s.completed).length;
        const percent = Math.round((completedCount / this.activeProject.steps.length) * 100);
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
        this.btnAddStepTemplate = document.getElementById('btn-add-step-template');

        // Add Step Listener
        if (this.btnAddStepTemplate) {
            this.btnAddStepTemplate.addEventListener('click', () => {
                const newStep = {
                    id: Date.now(),
                    title: "ขั้นตอนใหม่",
                    defaultChecklist: []
                };
                this.tempStepsTemplate.push(newStep);
                this.renderSettingsSteps();
                // Scroll to bottom
                setTimeout(() => {
                    this.settingsStepsContainer.scrollTop = this.settingsStepsContainer.scrollHeight;
                }, 100);
            });
        }

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
                this.openSettingsModal(true); // Global mode
            });
        }

        // Project Specific Edit Click
        if (this.btnEditProjectWorkflow) {
            this.btnEditProjectWorkflow.addEventListener('click', () => {
                this.openSettingsModal(false); // Project mode
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
                    if (this.isEditingGlobalSettings) {
                        // --- GLOBAL SAVE LOGIC ---
                        this.stepsTemplate = JSON.parse(JSON.stringify(this.tempStepsTemplate));

                        const workspace = await FirestoreManager.getWorkspaceData();
                        const projects = workspace.projects || [];

                        projects.forEach(p => {
                            if (p.steps && p.steps.length === this.stepsTemplate.length) {
                                p.steps.forEach((s, idx) => {
                                    const templateStep = this.stepsTemplate[idx];
                                    s.title = templateStep.title;
                                    const newChecklistTexts = templateStep.defaultChecklist || [];
                                    const existingItems = s.checklist || [];
                                    s.checklist = newChecklistTexts.map(text => {
                                        const match = existingItems.find(item => item.text === text);
                                        return { text: text, checked: match ? match.checked : false };
                                    });
                                });
                            }
                        });

                        await FirestoreManager.updateWorkspaceSettings(code, {
                            customSteps: this.stepsTemplate,
                            projects: projects
                        });
                        this.showToast('บันทึกการตั้งค่าและอัปเดตโครงการทั้งหมดแล้ว', 'success');
                    } else {
                        // --- PROJECT SPECIFIC SAVE LOGIC ---
                        if (!this.activeProject) return;

                        this.activeProject.steps = this.tempStepsTemplate.map((t, idx) => {
                            // Find existing step if possible (by ID or index)
                            const existing = this.activeProject.steps.find(s => s.id === t.id) || this.activeProject.steps[idx];

                            return {
                                id: t.id || idx + 1,
                                title: t.title,
                                completed: existing ? existing.completed : false,
                                completedAt: existing ? existing.completedAt : null,
                                notes: existing ? existing.notes : "",
                                checklist: t.defaultChecklist.map(text => {
                                    const match = existing ? existing.checklist.find(item => item.text === text) : null;
                                    return {
                                        text: text,
                                        checked: match ? match.checked : false
                                    };
                                })
                            };
                        });

                        // Adjust currentStepIndex if steps were removed and it's out of bounds
                        if (this.activeProject.currentStepIndex >= this.activeProject.steps.length) {
                            this.activeProject.currentStepIndex = Math.max(0, this.activeProject.steps.length - 1);
                        }

                        await FirestoreManager.updateProject(this.activeProject);
                        this.showToast(`จัดการขั้นตอนของโครงการ "${this.activeProject.name}" เรียบร้อยแล้ว`, 'success');

                        // Current view is already 'detail', so this will refresh the UI
                        this.openProjectDetail(this.activeProject.id, this.activeWorkflowStepIndex);
                    }

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

    openSettingsModal(isGlobal = true) {
        this.isEditingGlobalSettings = isGlobal;

        if (isGlobal) {
            this.tempStepsTemplate = JSON.parse(JSON.stringify(this.stepsTemplate));
            this.modalSettings.querySelector('h2').textContent = 'ตั้งค่าขั้นตอน (Global Template)';
            if (this.btnResetSteps) this.btnResetSteps.style.display = 'block';
        } else {
            // For specifically editing active project
            // We need to convert project.steps structure back to template structure
            this.tempStepsTemplate = this.activeProject.steps.map(s => ({
                id: s.id,
                title: s.title,
                defaultChecklist: s.checklist.map(c => c.text)
            }));
            this.modalSettings.querySelector('h2').textContent = `จัดการขั้นตอน: ${this.activeProject.name}`;
            if (this.btnResetSteps) this.btnResetSteps.style.display = 'none';
        }

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
                    <button class="btn-icon btn-edit-step" title="แก้ไข" data-index="${index}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon btn-delete-step" title="ลบ" data-index="${index}" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;

            const editBtn = div.querySelector('.btn-edit-step');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    this.openEditStepModal(index);
                });
            }

            const deleteBtn = div.querySelector('.btn-delete-step');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`คุณแน่ใจหรือไม่ที่จะลบขั้นตอนที่ ${index + 1}: ${step.title}?`)) {
                        this.tempStepsTemplate.splice(index, 1);
                        this.renderSettingsSteps();
                    }
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

    renderTimeline() {
        if (!this.timelineList) return;
        this.timelineList.innerHTML = '';

        const stepData = this.activeProject.steps[this.activeWorkflowStepIndex];
        const timeline = stepData.timeline || [];

        // Sort by timestamp (descending)
        const sorted = [...timeline].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (sorted.length === 0) {
            this.timelineList.innerHTML = '<div style="color:var(--text-muted); font-size: 0.8rem; padding: 1rem; text-align: center;">ไม่มีบันทึกเหตุการณ์</div>';
            return;
        }

        sorted.forEach((note) => {
            const div = document.createElement('div');
            div.className = 'note-item';
            div.dataset.id = note.timestamp;

            const dateStr = new Date(note.timestamp).toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            div.innerHTML = `
                <div class="note-timestamp">
                    <span class="info-badge" style="background:none; padding:0;"><i class="fa-regular fa-clock"></i> ${dateStr}</span>
                    <div style="display:flex; gap:0.25rem;">
                        <button class="btn-note-edit" title="แก้ไข"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-delete-timeline" title="ลบ" style="background:none; border:none; color:var(--text-muted); cursor:pointer;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </div>
                <div class="note-content-display">${note.text}</div>
                <div class="note-edit-box" style="display:none;">
                    <textarea class="note-edit-area">${note.text}</textarea>
                    <div class="note-edit-actions">
                        <button class="btn btn-sm btn-outline btn-cancel-edit">ยกเลิก</button>
                        <button class="btn btn-sm btn-primary btn-save-edit">บันทึก</button>
                    </div>
                </div>
            `;

            const display = div.querySelector('.note-content-display');
            const editBox = div.querySelector('.note-edit-box');
            const textarea = div.querySelector('.note-edit-area');

            // Toggle Edit
            div.querySelector('.btn-note-edit').addEventListener('click', () => {
                display.style.display = 'none';
                editBox.style.display = 'block';
                textarea.focus();
            });

            // Cancel Edit
            div.querySelector('.btn-cancel-edit').addEventListener('click', () => {
                display.style.display = 'block';
                editBox.style.display = 'none';
                textarea.value = note.text;
            });

            // Save Edit
            div.querySelector('.btn-save-edit').addEventListener('click', async () => {
                const newText = textarea.value.trim();
                if (!newText) return;

                note.text = newText;
                await FirestoreManager.updateProject(this.activeProject);
                this.renderTimeline();
                this.showToast('แก้ไขบันทึกแล้ว', 'success');
            });

            div.querySelector('.btn-delete-timeline').addEventListener('click', async () => {
                if (confirm('ลบบันทึกเหตุการณ์นี้?')) {
                    stepData.timeline = stepData.timeline.filter(n => n.timestamp !== note.timestamp);
                    await FirestoreManager.updateProject(this.activeProject);
                    this.renderTimeline();
                }
            });

            this.timelineList.appendChild(div);
        });
    }

    renderPostits() {
        if (!this.postitsList) return;
        this.postitsList.innerHTML = '';

        const stepData = this.activeProject.steps[this.activeWorkflowStepIndex];
        const postits = stepData.postits || [];

        if (postits.length === 0) {
            this.postitsList.innerHTML = '<div style="color:var(--text-muted); font-size: 0.8rem; padding: 1rem; text-align: center; grid-column: 1/-1;">ไม่มีแผ่นโน้ต</div>';
            return;
        }

        postits.forEach((note, idx) => {
            const div = document.createElement('div');
            div.className = 'note-item';

            const dateStr = new Date(note.timestamp).toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            });

            div.innerHTML = `
                <div class="note-timestamp">
                    <span>${dateStr}</span>
                    <div style="display:flex; gap:0.25rem;">
                        <button class="btn-note-edit" title="แก้ไข" style="background:none; border:none; color:inherit; cursor:pointer; opacity:0.6;"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-delete-postit" title="ลบ" style="background:none; border:none; color:inherit; cursor:pointer;"><i class="fa-solid fa-times"></i></button>
                    </div>
                </div>
                <div class="note-content-display" style="white-space: pre-wrap;">${note.text}</div>
                <div class="note-edit-box" style="display:none;">
                    <textarea class="note-edit-area" style="height:80%;">${note.text}</textarea>
                    <div class="note-edit-actions">
                        <button class="btn btn-sm btn-cancel-edit">X</button>
                        <button class="btn btn-sm btn-save-edit" style="background:rgba(0,0,0,0.1);">บันทึก</button>
                    </div>
                </div>
            `;

            const display = div.querySelector('.note-content-display');
            const editBox = div.querySelector('.note-edit-box');
            const textarea = div.querySelector('.note-edit-area');

            // Toggle Edit
            div.querySelector('.btn-note-edit').addEventListener('click', () => {
                display.style.display = 'none';
                editBox.style.display = 'flex';
                editBox.style.flexDirection = 'column';
                textarea.focus();
            });

            // Cancel Edit
            div.querySelector('.btn-cancel-edit').addEventListener('click', () => {
                display.style.display = 'block';
                editBox.style.display = 'none';
                textarea.value = note.text;
            });

            // Save Edit
            div.querySelector('.btn-save-edit').addEventListener('click', async () => {
                const newText = textarea.value.trim();
                if (!newText) return;

                note.text = newText;
                await FirestoreManager.updateProject(this.activeProject);
                this.renderPostits();
                this.showToast('แก้ไขโน้ตแล้ว', 'success');
            });

            div.querySelector('.btn-delete-postit').addEventListener('click', async () => {
                if (confirm('ลบโพสต์อิทนี้?')) {
                    stepData.postits.splice(idx, 1);
                    await FirestoreManager.updateProject(this.activeProject);
                    this.renderPostits();
                }
            });

            this.postitsList.appendChild(div);
        });
    }

    async addTimelineEntry() {
        if (!this.activeProject) return;
        const text = this.inpTimeline.value.trim();
        if (!text) return;

        const currentStep = this.activeProject.steps[this.activeWorkflowStepIndex];
        if (!currentStep.timeline) currentStep.timeline = [];

        currentStep.timeline.push({
            text,
            timestamp: new Date().toISOString()
        });

        await FirestoreManager.updateProject(this.activeProject);
        this.inpTimeline.value = '';
        this.renderTimeline();
        this.showToast('เพิ่มบันทึกเหตุการณ์แล้ว', 'success');
    }

    async addPostit() {
        if (!this.activeProject) return;
        const text = this.inpPostit.value.trim();
        if (!text) return;

        const currentStep = this.activeProject.steps[this.activeWorkflowStepIndex];
        if (!currentStep.postits) currentStep.postits = [];

        currentStep.postits.push({
            text,
            timestamp: new Date().toISOString()
        });

        await FirestoreManager.updateProject(this.activeProject);
        this.inpPostit.value = '';
        this.renderPostits();
        this.showToast('แปะโน้ตเรียบร้อยแล้ว', 'success');
    }

    async exportToPDF() {
        if (!this.activeProject) return;
        const project = this.activeProject;

        const element = document.createElement('div');
        element.className = 'pdf-template';

        let stepsHtml = '';
        project.steps.forEach((step, idx) => {
            const checklistItems = step.checklist.map(item => {
                const dateStr = item.completedAt ? ` <span style="font-size: 0.8rem; color: #64748b;">(${new Date(item.completedAt).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })})</span>` : '';
                return `<li>${item.checked ? '[✓]' : '[ ]'} ${item.text}${dateStr}</li>`;
            }).join('');

            let notesHtml = '';
            const timeline = step.timeline || (Array.isArray(step.notes) ? step.notes.filter(n => !n.type || n.type === 'timeline') : []);
            const postits = step.postits || (Array.isArray(step.notes) ? step.notes.filter(n => n.type === 'postit') : []);

            if (timeline.length > 0 || postits.length > 0) {
                let timelineHtml = '';
                if (timeline.length > 0) {
                    const sortedT = [...timeline].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                    timelineHtml = `<div style="margin-bottom: 5px;"><strong style="font-size: 0.8rem; color: #475569;">บันทึกเหตุการณ์:</strong>` + sortedT.map(note =>
                        `<div class="pdf-notes" style="margin-top: 3px; border-left: 2px solid #6366f1; padding-left: 8px; background: #f8fafc; margin-bottom: 3px;">
                            <div style="font-size: 0.65rem; color: #64748b;">${new Date(note.timestamp).toLocaleString('th-TH')}</div>
                            <div style="font-size: 0.8rem;">${note.text}</div>
                        </div>`
                    ).join('') + `</div>`;
                }

                let postitsHtml = '';
                if (postits.length > 0) {
                    postitsHtml = `<div style="margin-top: 8px;"><strong style="font-size: 0.8rem; color: #475569;">กระดาษโน้ต:</strong>` + postits.map(note =>
                        `<div class="pdf-notes" style="background: #fef9c3; border-left: 2px solid #eab308; padding: 5px; margin-top: 3px;">
                            <div style="font-size: 0.8rem;">${note.text}</div>
                        </div>`
                    ).join('') + `</div>`;
                }

                notesHtml = `
                    <div style="margin-top: 10px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
                        ${timelineHtml}
                        ${postitsHtml}
                    </div>`;
            }

            stepsHtml += `
                <div class="pdf-step" style="page-break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 5px;">
                        <span>ขั้นตอนที่ ${idx + 1}: ${step.title}</span>
                        <span style="color: ${step.completed ? '#10b981' : '#64748b'}; font-size: 0.8rem;">
                            ${step.completed ? 'เสร็จสิ้นเมื่อ ' + new Date(step.completedAt).toLocaleDateString('th-TH') : 'ยังไม่ดำเนินการ'}
                        </span>
                    </div>
                    <ul style="list-style: none; padding-left: 5px; margin-bottom: 10px;">
                        ${checklistItems}
                    </ul>
                    ${notesHtml}
                </div>
            `;
        });

        element.style.width = '190mm';

        element.innerHTML = `
            <style>
                .pdf-template {
                    font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
                    line-height: 1.8;
                    color: #1e293b;
                    font-size: 12px;
                }
                .pdf-template * {
                    overflow-wrap: break-word;
                    word-wrap: break-word;
                }
                .pdf-header h1 {
                    font-size: 18px;
                    line-height: 2;
                    margin: 0;
                    color: #1e293b;
                }
                .pdf-section h2 {
                    font-size: 15px;
                    margin-bottom: 8px;
                    line-height: 2;
                }
                .pdf-step {
                    font-size: 12px;
                    line-height: 1.8;
                }
                .pdf-notes {
                    overflow-wrap: break-word;
                    word-wrap: break-word;
                    line-height: 1.8;
                }
                .pdf-template p {
                    line-height: 1.8;
                }
            </style>
            <div class="pdf-header" style="border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-bottom: 20px;">
                <div style="font-size: 1rem; color: #64748b; margin-bottom: 5px;">รายงานสรุปโครงการ</div>
                <h1 style="font-size: 1.3rem; line-height: 1.6; margin: 0; color: #1e293b;">${project.name}</h1>
                <p style="color: #64748b; margin: 5px 0 0 0; font-size: 0.75rem;">สร้างเมื่อ: ${new Date(project.createdAt).toLocaleDateString('th-TH')}</p>
            </div>
            
            <div class="pdf-section" style="margin-bottom: 20px;">
                <h2 style="color: #4f46e5; border-left: 4px solid #6366f1; padding-left: 10px;">ข้อมูลโครงการ</h2>
                <div style="padding-left: 15px;">
                    <p style="margin: 6px 0;"><strong>รายละเอียด:</strong> ${project.description || '-'}</p>
                    <p style="margin: 6px 0;"><strong>งบประมาณ:</strong> ${new Intl.NumberFormat('th-TH').format(project.budget)} บาท</p>
                    <p style="margin: 6px 0;"><strong>กำหนดเสร็จ:</strong> ${project.deadline ? new Date(project.deadline).toLocaleDateString('th-TH') : '-'}</p>
                    <p style="margin: 6px 0;"><strong>ระดับความเร่งด่วน:</strong> ${PRIORITY_LABELS[project.priority]?.label || 'ปกติ'}</p>
                    <p style="margin: 6px 0;"><strong>สถานะปัจจุบัน:</strong> ${project.status === 'completed' ? 'เสร็จสิ้นโครงการ' : 'กำลังดำเนินการ'}</p>
                </div>
            </div>
            
            <div class="pdf-section" style="margin-bottom: 20px;">
                <h2 style="color: #4f46e5; border-left: 4px solid #6366f1; padding-left: 10px;">ประวัติการดำเนินงาน (Workflow & Notes)</h2>
                ${stepsHtml}
            </div>

            <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px; font-size: 0.7rem; text-align: center; color: #94a3b8;">
                รายงานนี้ถูกสร้างโดยระบบ Procurement Tracker ณ วันที่ ${new Date().toLocaleString('th-TH')}
            </div>
        `;

        document.body.appendChild(element);

        // Force browser layout calculation before html2canvas captures
        element.offsetHeight;

        const opt = {
            margin: 10,
            filename: `Project_Report_${project.name}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        try {
            this.showToast('กำลังเตรียมไฟล์ PDF...', 'info');
            await html2pdf().set(opt).from(element).save();
            this.showToast('ดาวน์โหลด PDF เรียบร้อยแล้ว', 'success');
        } catch (error) {
            console.error('PDF Export Error:', error);
            this.showToast('ไม่สามารถสร้าง PDF ได้', 'error');
        } finally {
            document.body.removeChild(element);
        }
    }
}

// Start App
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
