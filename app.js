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
    constructor(name, description, budget, deadline, priority = 'normal', purchaseType = 'buy', template = STEPS_TEMPLATE, method = 'e-bidding', contractAmount = 0) {
        this.id = Date.now().toString(); // Simple ID generation
        this.name = name;
        this.description = description;
        this.budget = parseFloat(budget) || 0;
        this.contractAmount = parseFloat(contractAmount) || 0;
        this.deadline = deadline || null;
        this.priority = priority;
        this.purchaseType = purchaseType;
        this.procurementMethod = method;
        this.createdAt = new Date().toISOString();
        this.updatedAt = this.createdAt;
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
        project.updatedAt = new Date().toISOString();
        projects.unshift(project); // Add to top
        await this.saveWorkspace({ projects });
        return projects;
    }

    static async updateProject(updatedProject) {
        const projects = await this.getProjects();
        const index = projects.findIndex(p => p.id === updatedProject.id);
        if (index !== -1) {
            updatedProject.updatedAt = new Date().toISOString();
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

        // Preload celebration sound
        this.celebrationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
        this.celebrationSound.load();
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
        this.inpProjectContract = document.getElementById('inp-project-contract');
        this.inpProjectDeadline = document.getElementById('inp-project-deadline');
        this.inpProjectPriority = document.getElementById('inp-project-priority');
        this.inpProjectMethod = document.getElementById('inp-project-method');

        // Edit Project Info Modal Elements
        this.modalEditProject = document.getElementById('modal-edit-project');
        this.formEditProject = document.getElementById('form-edit-project');
        this.btnEditProjectInfo = document.getElementById('btn-edit-project-info');
        this.editProjectId = document.getElementById('edit-project-id');
        this.editProjectName = document.getElementById('edit-project-name');
        this.editProjectDesc = document.getElementById('edit-project-desc');
        this.editProjectBudget = document.getElementById('edit-project-budget');
        this.editProjectContract = document.getElementById('edit-project-contract');
        this.editProjectPriority = document.getElementById('edit-project-priority');
        this.editProjectDeadline = document.getElementById('edit-project-deadline');
        this.editProjectMethod = document.getElementById('edit-project-method');

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
        this.detailContractAmount = document.getElementById('detail-contract-amount');
        this.detailPriority = document.getElementById('detail-priority'); // Add this to HTML later or use a span
        this.detailPurchaseType = document.getElementById('detail-purchase-type');
        this.detailProcurementMethod = document.getElementById('detail-procurement-method');
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

        // Collapsible headers & sections
        this.headerTimeline = document.getElementById('header-timeline');
        this.headerPostits = document.getElementById('header-postits');
        this.sectionTimeline = document.getElementById('section-timeline');
        this.sectionPostits = document.getElementById('section-postits');

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

        const formatCurrency = (e) => {
            const val = e.target.value.replace(/,/g, '');
            if (!isNaN(val) && val !== '') {
                e.target.value = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(val);
            }
        };
        const unformatCurrency = (e) => {
            const val = e.target.value.replace(/,/g, '');
            if (!isNaN(val) && val !== '') {
                e.target.value = val;
            }
        };

        const budgetInputs = ['inp-project-budget', 'inp-project-contract', 'edit-project-budget', 'edit-project-contract'];
        budgetInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('blur', formatCurrency);
                el.addEventListener('focus', unformatCurrency);
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

        // Sidebar Toggle Logic
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const sidebar = document.querySelector('.sidebar');
        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
            });

            // Auto-collapse on mobile initially
            if (window.innerWidth <= 1024) {
                sidebar.classList.add('collapsed');
            }
        }

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
                this.editProjectBudget.value = p.budget ? new Intl.NumberFormat('th-TH').format(p.budget) : '';
                this.editProjectContract.value = p.contractAmount ? new Intl.NumberFormat('th-TH').format(p.contractAmount) : '';
                this.editProjectPriority.value = p.priority || 'normal';

                // Populate Purchase Type
                if (document.getElementById('edit-project-type')) {
                    document.getElementById('edit-project-type').value = p.purchaseType || 'buy';
                }

                // Populate Procurement Method
                if (this.editProjectMethod) {
                    this.editProjectMethod.value = p.procurementMethod || 'e-bidding';
                }

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
                    budget: parseFloat(this.editProjectBudget.value.replace(/,/g, '')) || 0,
                    contractAmount: parseFloat(this.editProjectContract.value.replace(/,/g, '')) || 0,
                    priority: this.editProjectPriority.value,
                    purchaseType: document.getElementById('edit-project-type').value,
                    procurementMethod: this.editProjectMethod.value,
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

        // Collapsible Sections
        if (this.headerTimeline) {
            this.headerTimeline.addEventListener('click', () => {
                this.sectionTimeline.classList.toggle('active');
            });
        }
        if (this.headerPostits) {
            this.headerPostits.addEventListener('click', () => {
                this.sectionPostits.classList.toggle('active');
            });
        }
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
        const purchaseType = document.getElementById('inp-project-type').value || 'buy';

        let budgetRaw = this.inpProjectBudget.value;
        budgetRaw = budgetRaw.replace(/,/g, '');
        const budget = parseFloat(budgetRaw) || 0;

        const method = this.inpProjectMethod.value || 'e-bidding';
        let contractRaw = this.inpProjectContract.value.replace(/,/g, '');
        const contractAmount = parseFloat(contractRaw) || 0;

        const deadline = this.inpProjectDeadline.value;

        const newProject = new Project(name, desc, budget, deadline, priority, purchaseType, this.stepsTemplate, method, contractAmount);
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
        // Sort by updatedAt descending
        const sortedForActivity = [...projects].sort((a, b) => {
            const dateA = new Date(a.updatedAt || a.createdAt);
            const dateB = new Date(b.updatedAt || b.createdAt);
            return dateB - dateA;
        });
        const recentProjects = sortedForActivity.slice(0, 5);

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

        const methodGroups = [
            { id: 'e-bidding', label: 'e-bidding', icon: 'fa-solid fa-gavel' },
            { id: 'specific', label: 'เฉพาะเจาะจง', icon: 'fa-solid fa-bullseye' },
            { id: 'selection', label: 'คัดเลือก', icon: 'fa-solid fa-users-viewfinder' }
        ];

        methodGroups.forEach(group => {
            const groupProjects = filtered.filter(p => (p.procurementMethod || 'e-bidding') === group.id);
            if (groupProjects.length === 0) return;

            // Render Header
            const header = document.createElement('div');
            header.className = 'grid-group-header';
            header.innerHTML = `<div class="group-icon"><i class="${group.icon}"></i></div> ${group.label}`;
            this.projectsGrid.appendChild(header);

            // Sort within group: newest first
            groupProjects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            groupProjects.forEach(p => {
                const card = document.createElement('div');
                card.className = 'project-card';

                const budgetFormatted = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(p.budget);
                const completedStepsCount = p.steps.filter(s => s.completed).length;
                const progress = Math.round((completedStepsCount / p.steps.length) * 100);

                const priorityCfg = PRIORITY_LABELS[p.priority] || PRIORITY_LABELS['normal'];

                // Purchase Type Badge
                const purchaseTypeLabels = {
                    'buy': { label: 'ซื้อ', class: 'priority-normal', icon: 'fa-solid fa-cart-shopping' },
                    'hire': { label: 'จ้าง', class: 'priority-urgent', icon: 'fa-solid fa-briefcase' },
                    'rent': { label: 'เช่า', class: 'priority-most-urgent', icon: 'fa-solid fa-file-contract' }
                };
                const pType = p.purchaseType ? (purchaseTypeLabels[p.purchaseType] || purchaseTypeLabels['buy']) : purchaseTypeLabels['buy'];

                let pTypeColor = 'rgba(59, 130, 246, 0.12)'; // Blue
                let pTextColor = '#3b82f6';
                let pBorderColor = 'rgba(59, 130, 246, 0.4)';

                if (p.purchaseType === 'hire') {
                    pTypeColor = 'rgba(168, 85, 247, 0.12)';
                    pTextColor = '#a855f7';
                    pBorderColor = 'rgba(168, 85, 247, 0.4)';
                }
                if (p.purchaseType === 'rent') {
                    pTypeColor = 'rgba(236, 72, 153, 0.12)';
                    pTextColor = '#ec4899';
                    pBorderColor = 'rgba(236, 72, 153, 0.4)';
                }

                const purchaseTypeBadge = `
                    <span class="priority-badge" style="background: ${pTypeColor}; color: ${pTextColor}; border: 1px solid ${pBorderColor};">
                        <i class="${pType.icon}"></i> ${pType.label}
                    </span>`;

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
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            ${purchaseTypeBadge}
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <span class="priority-badge ${priorityCfg.class}">
                                <i class="${priorityCfg.icon}"></i> ${priorityCfg.label}
                            </span>
                        </div>
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
        });
    }

    async openProjectDetail(id, stepIndex = null) {
        const project = await FirestoreManager.getProject(id);
        if (!project) return;

        this.activeProject = project;
        this.loadView('detail');

        this.detailTitle.textContent = project.name;

        // Status Logic for Detail View
        let statusClass = 'status-active';
        let statusText = 'กำลังดำเนินการ';
        if (project.status === 'completed') {
            statusClass = 'status-completed';
            statusText = 'เสร็จสิ้น';
        } else if (project.deadline) {
            const dayDiff = Math.ceil((new Date(project.deadline) - new Date()) / (1000 * 60 * 60 * 24));
            if (dayDiff < 3 && dayDiff >= 0) {
                statusClass = 'status-urgent';
            }
        }
        this.detailStatus.textContent = statusText;
        this.detailStatus.className = `status-badge ${statusClass}`;

        this.detailDesc.textContent = project.description || 'ไม่มีรายละเอียด';
        this.detailStartDate.textContent = new Date(project.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
        this.detailDeadline.textContent = project.deadline ? new Date(project.deadline).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
        this.detailBudget.textContent = new Intl.NumberFormat('th-TH').format(project.budget);
        this.detailContractAmount.textContent = project.contractAmount ? new Intl.NumberFormat('th-TH').format(project.contractAmount) : '0';

        const priorityCfg = PRIORITY_LABELS[project.priority] || PRIORITY_LABELS['normal'];
        this.detailPriority.innerHTML = `<i class="${priorityCfg.icon}"></i> ${priorityCfg.label}`;
        this.detailPriority.className = `priority-badge ${priorityCfg.class}`;

        // Sync Priority Style to Glassmorphism (same as purchase type logic)
        const prioColorMap = {
            'priority-normal': '#10b981',
            'priority-urgent': '#f97316',
            'priority-very-urgent': '#ef4444',
            'priority-most-urgent': '#ff4d4d',
            'priority-extreme': '#ff4d4d'
        };
        const colorPrio = prioColorMap[priorityCfg.class] || '#10b981';
        this.detailPriority.style.backgroundColor = colorPrio.includes('#') ? colorPrio + '1F' : 'rgba(255,255,255,0.1)'; // 1F is ~12%
        this.detailPriority.style.color = colorPrio;
        this.detailPriority.style.border = `1px solid ${colorPrio}${colorPrio.includes('#') ? '66' : ''}`; // 66 is ~40%
        this.detailPriority.style.backdropFilter = 'blur(4px)';

        // Purchase Type - Updated Colors
        const pTypeLabels = {
            'buy': { label: 'ซื้อ', color: '#3b82f6', icon: 'fa-solid fa-cart-shopping' }, // Blue
            'hire': { label: 'จ้าง', color: '#a855f7', icon: 'fa-solid fa-briefcase' }, // Purple
            'rent': { label: 'เช่า', color: '#ec4899', icon: 'fa-solid fa-file-contract' } // Pink
        };
        const pType = project.purchaseType ? (pTypeLabels[project.purchaseType] || pTypeLabels['buy']) : pTypeLabels['buy'];

        if (this.detailPurchaseType) {
            this.detailPurchaseType.innerHTML = `<i class="${pType.icon}"></i> ${pType.label}`;

            // Set Transparent Style
            const baseColor = pType.color;
            this.detailPurchaseType.style.backgroundColor = baseColor.replace('rgb', 'rgba').replace(')', ', 0.15)');
            if (!baseColor.includes('rgba')) {
                const rgbaMap = { '#3b82f6': 'rgba(59, 130, 246, 0.15)', '#a855f7': 'rgba(168, 85, 247, 0.15)', '#ec4899': 'rgba(236, 72, 153, 0.15)' };
                this.detailPurchaseType.style.backgroundColor = rgbaMap[baseColor] || 'rgba(255,255,255,0.1)';
            }
            this.detailPurchaseType.style.color = baseColor;
            this.detailPurchaseType.style.border = `1px solid ${baseColor.replace(')', ', 0.3)')}`;
            if (!baseColor.includes('rgba')) {
                this.detailPurchaseType.style.borderColor = baseColor + '4D';
            }
        }

        // Procurement Method Rendering
        const methodLabels = {
            'e-bidding': { label: 'e-bidding', color: '#10b981', icon: 'fa-solid fa-gavel' },
            'specific': { label: 'เฉพาะเจาะจง', color: '#f59e0b', icon: 'fa-solid fa-bullseye' },
            'selection': { label: 'คัดเลือก', color: '#6366f1', icon: 'fa-solid fa-users-viewfinder' }
        };
        const pMethod = methodLabels[project.procurementMethod] || methodLabels['e-bidding'];

        if (this.detailProcurementMethod) {
            this.detailProcurementMethod.innerHTML = `<i class="${pMethod.icon}"></i> ${pMethod.label}`;
            const mColor = pMethod.color;
            this.detailProcurementMethod.style.backgroundColor = mColor + '1F';
            this.detailProcurementMethod.style.color = mColor;
            this.detailProcurementMethod.style.border = `1px solid ${mColor}66`;
        }

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

            tab.innerHTML = `${icon} <span>${step.title}</span>`;
            tab.addEventListener('click', () => {
                this.loadWorkflowStep(index);
                this.toggleStepCompletion();
            });
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

        // Collapse sections when changing steps
        if (this.sectionTimeline) this.sectionTimeline.classList.remove('active');
        if (this.sectionPostits) this.sectionPostits.classList.remove('active');

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

            // Show completion info
            let infoEl = document.getElementById('step-completion-info');
            if (!infoEl) {
                infoEl = document.createElement('div');
                infoEl.id = 'step-completion-info';
                this.btnCompleteStep.parentNode.insertBefore(infoEl, this.btnCompleteStep.nextSibling);
            }
            const dateStr = stepData.completedAt ? new Date(stepData.completedAt).toLocaleDateString('th-TH') : '-';
            const docNum = stepData.documentNumber || '-';
            infoEl.innerHTML = `
                <div style="margin-top: 10px; padding: 10px 14px; background: rgba(16,185,129,0.1); border-left: 3px solid #10b981; border-radius: 6px; font-size: 0.85rem; color: var(--text-secondary);">
                    <div><i class="fa-solid fa-circle-check" style="color: #10b981;"></i> เสร็จสิ้นเมื่อ: <strong>${dateStr}</strong></div>
                    <div style="margin-top: 4px;"><i class="fa-solid fa-file-lines" style="color: #6366f1;"></i> เลขหนังสือ: <strong>${docNum}</strong></div>
                </div>
            `;
        } else {
            this.btnCompleteStep.innerHTML = '<i class="fa-regular fa-circle-check"></i> ทำขั้นตอนเสร็จสิ้น';
            this.btnCompleteStep.classList.add('btn-outline'); // Standard outline
            // Highlight if it's the current active step
            if (index === this.activeProject.currentStepIndex) {
                this.btnCompleteStep.classList.add('btn-primary');
                this.btnCompleteStep.classList.remove('btn-outline');
            }
            // Remove completion info if reverting
            const infoEl = document.getElementById('step-completion-info');
            if (infoEl) infoEl.remove();
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

        if (step.completed) {
            // --- Reverting: no popup needed ---
            step.completed = false;
            step.completedAt = null;
            step.documentNumber = null;
            this.showToast(`ยกเลิกสถานะเสร็จสิ้น ขั้นตอนที่ ${stepIndex + 1}`, 'info');
            await this._saveAndRefreshStep(stepIndex);
        } else {
            // --- Completing: show popup ---
            const modal = document.getElementById('modal-step-complete');
            const label = document.getElementById('step-complete-label');
            const inpDocNumber = document.getElementById('inp-step-doc-number');
            const inpDate = document.getElementById('inp-step-complete-date');
            const btnConfirm = document.getElementById('btn-confirm-step-complete');

            label.textContent = `ขั้นตอนที่ ${stepIndex + 1}: ${step.title}`;
            inpDocNumber.value = step.documentNumber || '';
            inpDate.value = new Date().toISOString().split('T')[0]; // Default to today
            modal.classList.add('open');

            // Remove any previous listener
            const newBtn = btnConfirm.cloneNode(true);
            btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);

            newBtn.addEventListener('click', async () => {
                step.completed = true;
                step.documentNumber = inpDocNumber.value.trim() || null;

                const selectedDate = inpDate.value;
                step.completedAt = selectedDate
                    ? new Date(selectedDate).toISOString()
                    : new Date().toISOString();

                modal.classList.remove('open');
                this.showToast(`บันทึกขั้นตอนที่ ${stepIndex + 1} เสร็จสิ้น`, 'success');
                await this._saveAndRefreshStep(stepIndex);
            });
        }
    }

    async _saveAndRefreshStep(stepIndex) {
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
        const totalSteps = this.activeProject.steps.length;
        const percent = Math.round((completedCount / totalSteps) * 100);
        this.detailOverallProgress.style.width = `${percent}%`;
        this.detailProgressPercent.textContent = `${percent}%`;

        // Celebration if 100% and it was just completed
        const step = this.activeProject.steps[stepIndex];
        if (percent === 100 && step.completed) {
            this.triggerCelebration();
        }
    }

    triggerCelebration() {
        // Fireball confetti
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(() => {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            // since particles fall down, start a bit higher than random
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);

        // Play sound (Pre-loaded)
        if (this.celebrationSound) {
            this.celebrationSound.currentTime = 0; // Reset to start
            this.celebrationSound.volume = 0.5;
            this.celebrationSound.play().catch(e => console.log('Audio play failed:', e));
        }

        this.showToast('🎉 ยินดีด้วย! คุณสะสางโครงการนี้สำเร็จแล้ว', 'success');
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
        if (this.sectionTimeline) this.sectionTimeline.classList.add('active');
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
        if (this.sectionPostits) this.sectionPostits.classList.add('active');
        this.renderPostits();
        this.showToast('แปะโน้ตเรียบร้อยแล้ว', 'success');
    }

    async exportToPDF() {
        if (!this.activeProject) return;
        const project = this.activeProject;

        try {
            this.showToast('กำลังเตรียมไฟล์ PDF...', 'info');

            // --- Helper: build procurement type label ---
            const getPurchaseTypeLabel = (type) => {
                const map = { buy: 'ซื้อ (Buy)', hire: 'จ้าง (Hire)', rent: 'เช่า (Rent)' };
                return map[type] || '-';
            };

            // --- Helper: build procurement method label ---
            const getMethodLabel = (method) => {
                const map = { 'e-bidding': 'e-bidding', 'specific': 'เฉพาะเจาะจง', 'selection': 'คัดเลือก' };
                return map[method] || method || '-';
            };

            // --- 1. Build HTML report ---
            const container = document.createElement('div');
            container.id = 'pdf-render-area';
            container.style.cssText = `
                position: fixed; left: -9999px; top: 0;
                width: 794px;
                background: white;
                font-family: 'Sarabun', sans-serif;
                color: #1e293b;
                padding: 40px 50px;
                line-height: 1.7;
                font-size: 14px;
            `;

            // --- Title ---
            let html = `
                <div style="color: #64748b; font-size: 12px; margin-bottom: 4px;">รายงานสรุปโครงการ</div>
                <div style="font-size: 22px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">${this.escapeHtml(project.name)}</div>
                <div style="color: #64748b; font-size: 12px; margin-bottom: 12px;">สร้างเมื่อ: ${new Date(project.createdAt).toLocaleDateString('th-TH')}</div>
                <hr style="border: none; border-top: 2px solid #6366f1; margin-bottom: 16px;">
            `;

            // --- Project Info ---
            html += `<div style="font-size: 17px; font-weight: 700; color: #4f46e5; margin-bottom: 10px;">ข้อมูลโครงการ</div>`;
            const infoItems = [
                ['รายละเอียด', this.escapeHtml(project.description || '-')],
                ['งบประมาณ', `${new Intl.NumberFormat('th-TH').format(project.budget || 0)} บาท`],
                ['วงเงินตามสัญญา', `${new Intl.NumberFormat('th-TH').format(project.contractAmount || 0)} บาท`],
                ['ประเภทการจัดหา', getPurchaseTypeLabel(project.purchaseType)],
                ['วิธีการจัดหา', getMethodLabel(project.procurementMethod)],
                ['ระดับความเร่งด่วน', PRIORITY_LABELS[project.priority]?.label || 'ปกติ'],
                ['กำหนดเสร็จ (Deadline)', project.deadline ? new Date(project.deadline).toLocaleDateString('th-TH') : '-'],
                ['สถานะปัจจุบัน', project.status === 'completed' ? 'เสร็จสิ้นโครงการ' : 'กำลังดำเนินการ']
            ];
            html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px;">`;
            infoItems.forEach(([label, value], i) => {
                const bgColor = i % 2 === 0 ? '#f8fafc' : '#ffffff';
                html += `
                    <tr style="background: ${bgColor};">
                        <td style="padding: 7px 12px; font-weight: 600; color: #475569; width: 200px; border: 1px solid #e2e8f0; white-space: nowrap;">${label}</td>
                        <td style="padding: 7px 12px; color: #1e293b; border: 1px solid #e2e8f0;">${value}</td>
                    </tr>`;
            });
            html += `</table>`;

            // --- Workflow ---
            html += `<div style="font-size: 17px; font-weight: 700; color: #4f46e5; margin: 20px 0 10px;">ประวัติการดำเนินงาน (Workflow & Notes)</div>`;

            project.steps.forEach((step, index) => {
                const statusColor = step.completed ? '#10b981' : '#94a3b8';
                const statusText = step.completed ? `เสร็จสิ้นเมื่อ ${new Date(step.completedAt).toLocaleDateString('th-TH')}` : 'ยังไม่ดำเนินการ';

                html += `
                    <div style="background: #f1f5f9; padding: 8px 14px; border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 14px;">ขั้นตอนที่ ${index + 1}: ${this.escapeHtml(step.title)}</strong>
                        <span style="color: ${statusColor}; font-size: 12px;">${statusText}</span>
                    </div>
                `;

                // Document Number
                if (step.completed && step.documentNumber) {
                    html += `<div style="margin-left: 14px; margin-bottom: 6px; font-size: 13px; color: #475569;"><i>เลขหนังสือ: ${this.escapeHtml(step.documentNumber)}</i></div>`;
                }

                // Checklist
                if (step.checklist && step.checklist.length > 0) {
                    step.checklist.forEach(item => {
                        const icon = item.checked ? '☑' : '☐';
                        const style = item.checked ? 'text-decoration: line-through; color: #94a3b8;' : '';
                        html += `<div style="margin-left: 20px; margin-bottom: 2px; ${style}">${icon} ${this.escapeHtml(item.text)}</div>`;
                    });
                }

                // Timeline notes
                const timeline = step.timeline || (Array.isArray(step.notes) ? step.notes.filter(n => !n.type || n.type === 'timeline') : []);
                if (timeline.length > 0) {
                    html += `<div style="margin-left: 20px; margin-top: 6px; font-weight: 700; color: #475569; font-size: 13px;">บันทึกเหตุการณ์:</div>`;
                    timeline.forEach(note => {
                        const timeStr = new Date(note.timestamp).toLocaleString('th-TH');
                        html += `<div style="margin-left: 28px; border-left: 3px solid #6366f1; padding-left: 8px; margin-bottom: 4px; font-size: 13px;">${timeStr} — ${this.escapeHtml(note.text)}</div>`;
                    });
                }

                // Postits
                const postits = step.postits || (Array.isArray(step.notes) ? step.notes.filter(n => n.type === 'postit') : []);
                if (postits.length > 0) {
                    html += `<div style="margin-left: 20px; margin-top: 6px; font-weight: 700; color: #475569; font-size: 13px;">กระดาษโน้ต:</div>`;
                    postits.forEach(note => {
                        html += `<div style="margin-left: 28px; background: #fef9c3; color: #854d0e; padding: 4px 8px; border-radius: 4px; margin-bottom: 4px; font-size: 13px;">${this.escapeHtml(note.text)}</div>`;
                    });
                }

                html += `<div style="margin-bottom: 12px;"></div>`;
            });

            // --- Footer placeholder (will be added per-page later) ---
            container.innerHTML = html;
            document.body.appendChild(container);

            // --- 2. Render to canvas with html2canvas ---
            const canvas = await html2canvas(container, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false
            });

            document.body.removeChild(container);

            // --- 3. Build PDF from canvas ---
            const { jsPDF } = window.jspdf;
            const imgWidth = 210; // A4 width in mm
            const pageHeight = 297; // A4 height in mm
            const marginTop = 10;
            const marginBottom = 15;
            const contentHeight = pageHeight - marginTop - marginBottom;

            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const ratio = imgWidth / canvasWidth;
            const totalPdfHeight = canvasHeight * ratio;

            const doc = new jsPDF('p', 'mm', 'a4');

            let heightLeft = totalPdfHeight;
            let position = 0;
            let page = 1;

            // Slice and add pages
            while (heightLeft > 0) {
                if (page > 1) doc.addPage();

                // Calculate source slice from canvas
                const sliceHeight = Math.min(contentHeight / ratio, canvasHeight - position);
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvasWidth;
                sliceCanvas.height = sliceHeight;
                const ctx = sliceCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, position, canvasWidth, sliceHeight, 0, 0, canvasWidth, sliceHeight);

                const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
                const sliceRenderHeight = sliceHeight * ratio;

                doc.addImage(sliceData, 'JPEG', 0, marginTop, imgWidth, sliceRenderHeight);

                position += sliceHeight;
                heightLeft -= contentHeight;
                page++;
            }

            // --- 4. Add footer to all pages ---
            const pageCount = doc.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(148, 163, 184);
                doc.text(`Procurement Tracker System - ${new Date().toLocaleString('th-TH')} - Page ${i}/${pageCount}`, 105, 292, { align: 'center' });
            }

            doc.save(`Project_Report_${project.name}.pdf`);
            this.showToast('ดาวน์โหลด PDF เรียบร้อยแล้ว', 'success');

        } catch (error) {
            console.error('PDF Export Error:', error);
            this.showToast('เกิดข้อผิดพลาดในการสร้าง PDF: ' + error.message, 'error');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

// Start App
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
